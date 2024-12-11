export default () => {
  self.addEventListener('message', (event) => {
    const { a, b } = event.data;

    const sum = a + b;

    self.postMessage(sum);
  });
};
