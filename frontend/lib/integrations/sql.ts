/** A timestamptz column as an ISO-8601 UTC string ("2026-11-18T05:03:07.713Z"),
 *  the format the UI and Date.parse expect — Postgres' own text form is not. */
export const isoSql = (col: string) => `to_char(${col} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`
