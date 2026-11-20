import { List, type RowComponentProps } from 'react-window';
import Avatar from '@mui/material/Avatar';
import Chip from '@mui/material/Chip';
import ListItem from '@mui/material/ListItem';
import ListItemAvatar from '@mui/material/ListItemAvatar';
import ListItemText from '@mui/material/ListItemText';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import type { TransactionRow } from '../types';

const ROW_HEIGHT = 72;

const AVATAR_COLORS = [
  '#1976d2',
  '#9c27b0',
  '#2e7d32',
  '#ed6c02',
  '#0288d1',
  '#d32f2f',
  '#5d4037',
  '#455a64',
];

function avatarColor(merchant: string): string {
  let hash = 0;
  for (const char of merchant) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

function TransactionItem({
  index,
  style,
  ariaAttributes,
  rows,
}: RowComponentProps<{ rows: TransactionRow[] }>) {
  const row = rows[index];
  return (
    <ListItem
      component="div"
      style={style}
      {...ariaAttributes}
      divider
      data-testid="transaction-row"
    >
      <ListItemAvatar>
        <Avatar sx={{ bgcolor: avatarColor(row.merchant) }}>
          {row.merchant[0]}
        </Avatar>
      </ListItemAvatar>
      {/* Rows have a fixed height, so long text is truncated, not wrapped. */}
      <ListItemText
        disableTypography
        sx={{ minWidth: 0 }}
        primary={<Typography noWrap>{row.merchant}</Typography>}
        secondary={
          <Typography variant="body2" color="text.secondary" noWrap>
            #{row.id} · {row.details}
          </Typography>
        }
      />
      <Stack
        direction="row"
        spacing={1}
        sx={{ alignItems: 'center', flexShrink: 0, ml: 2 }}
      >
        {row.flagged && <Chip size="small" color="warning" label="Review" />}
        <Typography
          variant="body2"
          sx={{ fontVariantNumeric: 'tabular-nums', fontWeight: 500 }}
        >
          {row.amountLabel}
        </Typography>
      </Stack>
    </ListItem>
  );
}

/**
 * MUI list items, virtualized with react-window: only the rows on screen are
 * rendered, so 100,000 rows scroll smoothly.
 */
export function TransactionList({
  rows,
  height,
}: {
  rows: TransactionRow[];
  height: number;
}) {
  return (
    <List
      data-testid="transaction-list"
      rowComponent={TransactionItem}
      rowCount={rows.length}
      rowHeight={ROW_HEIGHT}
      rowProps={{ rows }}
      overscanCount={8}
      style={{ height }}
    />
  );
}
