import { useDeferredValue, useMemo, useState } from 'react';
import Alert from '@mui/material/Alert';
import AppBar from '@mui/material/AppBar';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import Container from '@mui/material/Container';
import Divider from '@mui/material/Divider';
import LinearProgress from '@mui/material/LinearProgress';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Toolbar from '@mui/material/Toolbar';
import Typography from '@mui/material/Typography';
import { Stat } from './components/Stat';
import { SummaryPanel } from './components/SummaryPanel';
import { TransactionList } from './components/TransactionList';
import { useMemoryHandles } from './hooks/useMemoryHandles';
import { useTransactions } from './hooks/useTransactions';
import { THREADS } from './workers/factory';

const ROW_COUNT = 100_000;
const LIST_HEIGHT = 560;

const ms = (value: number | undefined) =>
  value === undefined ? '–' : `${Math.round(value).toLocaleString('en-US')} ms`;

export default function App() {
  const [runId, setRunId] = useState(0);
  const { status, rows, summary, timings, error, completedRun } =
    useTransactions(ROW_COUNT, runId);
  const memoryHandles = useMemoryHandles();

  // Filtering 100,000 rows takes a few milliseconds on the main thread;
  // useDeferredValue keeps typing responsive while the list catches up.
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query.trim().toLowerCase());
  const visibleRows = useMemo(
    () =>
      deferredQuery
        ? rows.filter((row) => row.searchText.includes(deferredQuery))
        : rows,
    [rows, deferredQuery],
  );

  const running = status === 'running';

  return (
    <>
      <AppBar position="sticky" elevation={0}>
        <Toolbar sx={{ gap: 2 }}>
          <Typography variant="h6" component="h1" sx={{ flexGrow: 1 }}>
            workerkit · React + MUI
          </Typography>
          <Button
            color="inherit"
            variant="outlined"
            disabled={running}
            onClick={() => setRunId((id) => id + 1)}
            data-testid="run-again"
          >
            Run again
          </Button>
        </Toolbar>
        {running && <LinearProgress color="secondary" />}
      </AppBar>

      <Container
        maxWidth="lg"
        sx={{ py: 3 }}
        data-completed-run={completedRun ?? undefined}
      >
        <Typography color="text.secondary" sx={{ maxWidth: 760 }}>
          {ROW_COUNT.toLocaleString('en-US')} transactions are generated,
          transformed (currency and date formatting, USD conversion, review
          flags) and summarized in Web Workers — split across {THREADS} threads.
          The page stays responsive throughout: try typing in the filter while
          it runs.
        </Typography>

        <Stack
          direction="row"
          spacing={2}
          useFlexGap
          sx={{ my: 3, flexWrap: 'wrap' }}
        >
          <Stat
            label="Status"
            value={status === 'done' ? 'Done' : running ? 'Running…' : 'Error'}
            testId="status"
          />
          <Stat
            label="Rows"
            value={rows.length.toLocaleString('en-US')}
            testId="row-count"
          />
          <Stat label="Threads per step" value={THREADS} />
          <Stat label="Generate" value={ms(timings?.generate)} />
          <Stat label="Transform" value={ms(timings?.transform)} />
          <Stat label="Summarize" value={ms(timings?.summarize)} />
          <Stat
            label="Results stored in MemoryWorker"
            value={memoryHandles ?? '–'}
            testId="memory-handles"
          />
        </Stack>

        {error && (
          <Alert severity="error" sx={{ mb: 3 }} data-testid="error">
            {error}
          </Alert>
        )}

        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', md: '2fr 1fr' },
            gap: 3,
            alignItems: 'start',
          }}
        >
          <Paper variant="outlined">
            <Stack
              direction="row"
              spacing={2}
              sx={{ p: 2, alignItems: 'center' }}
            >
              <TextField
                fullWidth
                size="small"
                label="Filter rows"
                placeholder="Merchant, category, country or #id"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
              <Typography
                variant="body2"
                color="text.secondary"
                sx={{ whiteSpace: 'nowrap' }}
                data-testid="visible-count"
              >
                {visibleRows.length.toLocaleString('en-US')} shown
              </Typography>
            </Stack>
            <Divider />
            {rows.length === 0 ? (
              <Box
                sx={{
                  height: LIST_HEIGHT,
                  display: 'grid',
                  placeItems: 'center',
                }}
              >
                {running ? <CircularProgress /> : null}
              </Box>
            ) : (
              <TransactionList rows={visibleRows} height={LIST_HEIGHT} />
            )}
          </Paper>
          <SummaryPanel summary={summary} />
        </Box>
      </Container>
    </>
  );
}
