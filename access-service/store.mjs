// Execute all three statements as one transaction. Revocation, incrementing
// and deduplication then have the same semantics in SQLite and Cloudflare D1.
export function unlockStatements(hash, receipt, now) {
  return [
    ['DELETE FROM unlock_receipts WHERE expires <= ?', [now]],
    [`UPDATE invitations
      SET successes = successes + CASE WHEN EXISTS
        (SELECT 1 FROM unlock_receipts WHERE digest = ?) THEN 0 ELSE 1 END
      WHERE code_hash = ? AND revoked = 0 RETURNING id`, [receipt, hash]],
    [`INSERT OR IGNORE INTO unlock_receipts(digest, expires)
      SELECT ?, ? FROM invitations WHERE code_hash = ? AND revoked = 0`,
      [receipt, now + 600, hash]]
  ];
}
