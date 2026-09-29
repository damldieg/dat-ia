/**
 * Always-visible local privacy notice. The page never sees raw database rows:
 * it only receives the allowlisted DTO produced by the local API adapter.
 */
export function PrivacyNotice() {
  return (
    <p className="privacy-notice" role="note">
      <strong>Local only.</strong> The browser talks to a loopback API that reads{' '}
      <code>~/.local/share/opencode/opencode.db</code> <strong>read-only</strong>. Only session
      metadata is returned — never prompts, messages, credentials, account data, events, share URLs
      or raw metadata. Nothing leaves this machine.
    </p>
  );
}
