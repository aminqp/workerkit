import Paper from '@mui/material/Paper';
import Skeleton from '@mui/material/Skeleton';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Typography from '@mui/material/Typography';
import type { Summary } from '../types';

const usd = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});

/** Totals per category, computed by the `summarize` worker. */
export function SummaryPanel({ summary }: { summary: Summary | null }) {
  return (
    <Paper variant="outlined" sx={{ p: 2 }} data-testid="summary">
      <Typography variant="overline" color="text.secondary">
        Summary (computed in a worker)
      </Typography>
      {summary ? (
        <>
          <Typography variant="h5" data-testid="summary-total">
            {usd.format(summary.totalUsd)}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {summary.count.toLocaleString('en-US')} transactions ·{' '}
            {summary.flagged.toLocaleString('en-US')} flagged for review
          </Typography>
          <Table size="small" aria-label="Totals per category">
            <TableHead>
              <TableRow>
                <TableCell>Category</TableCell>
                <TableCell align="right">Count</TableCell>
                <TableCell align="right">Total (USD)</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {summary.byCategory.map((entry) => (
                <TableRow key={entry.category} data-testid="summary-category">
                  <TableCell>{entry.category}</TableCell>
                  <TableCell align="right">
                    {entry.count.toLocaleString('en-US')}
                  </TableCell>
                  <TableCell align="right">
                    {usd.format(entry.totalUsd)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </>
      ) : (
        <>
          <Skeleton variant="text" width="60%" height={40} />
          <Skeleton variant="rectangular" height={240} sx={{ mt: 2 }} />
        </>
      )}
    </Paper>
  );
}
