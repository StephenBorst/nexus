/**
 * One row of Orderly's private `GET /v1/positions` (via `usePrivateQuery`) — only the
 * fields our own views read. Closed symbols linger with position_qty 0 until settled.
 */
export type OrderlyPositionRow = {
  symbol: string;
  position_qty: number;
  position_value?: number;
  mark_price?: number;
  average_open_price?: number;
  unsettled_pnl?: number;
};
