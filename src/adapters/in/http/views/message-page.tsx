// A page that only says what happened (decision D29): an error, or that a plan or template is gone.
// The message is its heading; the site's header and footer lead on.
export function MessagePage({ message }: { message: string }) {
  return (
    <section class="message-page">
      <h1>{message}</h1>
    </section>
  );
}
