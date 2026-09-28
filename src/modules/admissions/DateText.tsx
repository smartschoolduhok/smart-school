/** Keep ISO dates intact and left-to-right inside Arabic sentences. */
export function DateText({ text }: { text: string }) {
  return <>{text.split(/(\d{4}-\d{2}-\d{2})/g).map((part, i) => /^\d{4}-\d{2}-\d{2}$/.test(part)
    ? <bdi className="whitespace-nowrap" dir="ltr" key={i}>{part}</bdi> : part)}</>;
}
