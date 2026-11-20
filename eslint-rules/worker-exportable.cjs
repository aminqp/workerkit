/**
 * Custom ESLint rule: worker-exportable
 *
 * Enforces that Web Worker files (*.worker.ts) only export named, callable
 * functions — the shape required by MainWorkerFactory.
 *
 * WHY: WorkerFactory serialises the function via `.toString()` and injects it
 * into a Blob worker. For this to work the export must be:
 *   ✓  export function myWorker(...) { ... }
 *   ✓  export const myWorker = function(...) { ... }
 *   ✓  export const myWorker = (...) => { ... }
 *
 * The following are flagged because they cannot be passed directly to
 * MainWorkerFactory as a worker function:
 *   ✗  export default ...          (anonymous / unnamed — no stable identifier)
 *   ✗  export class Foo { ... }    (not a plain function)
 *   ✗  export const x = 42        (not callable)
 *   ✗  export { foo } from '...'  (re-exports hide the original source)
 *
 * Bundled worker scripts written with `defineWorker` are loaded through
 * `createWorker` rather than imported, so for files that call `defineWorker`:
 *   ✓  export default defineWorker(...)   (the documented pattern)
 *   ✓  defineWorker(myWorker)             (no named export required)
 *
 * Hand-written worker scripts, also loaded through `createWorker`, listen for
 * messages themselves and need no named export either:
 *   ✓  self.onmessage = (event) => { ... }
 *   ✓  self.addEventListener('message', (event) => { ... })
 */

/** @type {import('eslint').Rule.RuleModule} */
module.exports = {
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'Enforce that worker files only export named functions importable by MainWorkerFactory',
      category: 'Web Workers',
      recommended: true,
    },
    schema: [],
    messages: {
      noDefaultExport:
        'Worker files must not use `export default`. ' +
        'Export a named function instead so it can be imported and passed to MainWorkerFactory. ' +
        'Example: export function myWorker({ data }) { ... }',

      noClassExport:
        "Worker files must not export classes ('{{name}}'). " +
        'MainWorkerFactory expects a plain callable function. ' +
        'Example: export function myWorker({ data }) { ... }',

      noNonFunctionExport:
        "Worker files must not export non-function values ('{{name}}'). " +
        'Only exported functions can be passed to MainWorkerFactory. ' +
        'Example: export function myWorker({ data }) { ... }',

      noReExport:
        'Worker files must not use re-exports (`export { ... } from ...`). ' +
        'Define and export the worker function directly in this file so ' +
        'WorkerFactory can serialise it via .toString().',

      mustExportFunction:
        'Worker files must export at least one named function. ' +
        'MainWorkerFactory requires a named exported function to run in the worker thread. ' +
        'Example: export function myWorker({ data }) { ... }',
    },
  },

  create(context) {
    let hasNamedFunctionExport = false;
    let usesDefineWorker = false;
    let listensForMessages = false;

    /** Returns true for `self`, `globalThis` (or no object at all). */
    function isWorkerGlobal(node) {
      return (
        !node ||
        (node.type === 'Identifier' &&
          (node.name === 'self' || node.name === 'globalThis'))
      );
    }

    /** Returns true for `onmessage`, `self.onmessage` or `globalThis.onmessage`. */
    function isOnMessageTarget(node) {
      if (node.type === 'Identifier') return node.name === 'onmessage';
      return (
        node.type === 'MemberExpression' &&
        !node.computed &&
        node.property.type === 'Identifier' &&
        node.property.name === 'onmessage' &&
        isWorkerGlobal(node.object)
      );
    }

    /** Returns true for `[self.]addEventListener('message', ...)`. */
    function isMessageListenerCall(node) {
      const { callee } = node;
      const isAddEventListener =
        (callee.type === 'Identifier' && callee.name === 'addEventListener') ||
        (callee.type === 'MemberExpression' &&
          !callee.computed &&
          callee.property.type === 'Identifier' &&
          callee.property.name === 'addEventListener' &&
          isWorkerGlobal(callee.object));
      const [type] = node.arguments;
      return (
        isAddEventListener &&
        type !== undefined &&
        type.type === 'Literal' &&
        type.value === 'message'
      );
    }

    /** Returns true when an AST node represents a function (any flavour). */
    function isFunction(node) {
      return (
        node.type === 'FunctionDeclaration' ||
        node.type === 'FunctionExpression' ||
        node.type === 'ArrowFunctionExpression'
      );
    }

    /** Returns true for a `defineWorker(...)` call. */
    function isDefineWorkerCall(node) {
      return (
        node &&
        node.type === 'CallExpression' &&
        node.callee.type === 'Identifier' &&
        node.callee.name === 'defineWorker'
      );
    }

    return {
      // defineWorker(...) anywhere marks a bundled worker script;
      // addEventListener('message', ...) marks a hand-written one
      CallExpression(node) {
        if (isDefineWorkerCall(node)) usesDefineWorker = true;
        if (isMessageListenerCall(node)) listensForMessages = true;
      },

      // self.onmessage = ... marks a hand-written worker script
      AssignmentExpression(node) {
        if (isOnMessageTarget(node.left)) listensForMessages = true;
      },

      // export default <anything> — except `export default defineWorker(...)`
      ExportDefaultDeclaration(node) {
        if (isDefineWorkerCall(node.declaration)) return;
        context.report({ node, messageId: 'noDefaultExport' });
      },

      // export function foo() {}  /  export class Foo {}  /  export const x = ...
      ExportNamedDeclaration(node) {
        const decl = node.declaration;

        // export { foo } from './somewhere'  — re-export from another module
        if (!decl) {
          if (node.source) {
            context.report({ node, messageId: 'noReExport' });
          }
          // plain `export { localVar }` — allowed (re-surfaces a local name)
          return;
        }

        if (decl.type === 'ClassDeclaration') {
          const name = decl.id ? decl.id.name : '<anonymous>';
          context.report({ node, messageId: 'noClassExport', data: { name } });
          return;
        }

        if (decl.type === 'FunctionDeclaration') {
          // export function foo() {}
          hasNamedFunctionExport = true;
          return;
        }

        if (decl.type === 'VariableDeclaration') {
          for (const declarator of decl.declarations) {
            const name =
              declarator.id && declarator.id.type === 'Identifier'
                ? declarator.id.name
                : '<unknown>';

            if (declarator.init && isFunction(declarator.init)) {
              // export const foo = () => {}  or  export const foo = function() {}
              hasNamedFunctionExport = true;
            } else if (
              decl.kind !== 'type' &&
              declarator.init !== null &&
              declarator.init !== undefined &&
              !isFunction(declarator.init)
            ) {
              context.report({
                node: declarator,
                messageId: 'noNonFunctionExport',
                data: { name },
              });
            }
          }
        }

        // TSTypeAliasDeclaration / TSInterfaceDeclaration — always fine, skip.
      },

      // After visiting the whole file, ensure at least one named function was
      // exported — unless it is a defineWorker or hand-written worker script,
      // which is loaded with createWorker and needs no export.
      'Program:exit'(node) {
        if (
          !hasNamedFunctionExport &&
          !usesDefineWorker &&
          !listensForMessages
        ) {
          context.report({ node, messageId: 'mustExportFunction' });
        }
      },
    };
  },
};
