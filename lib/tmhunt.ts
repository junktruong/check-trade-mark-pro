export async function callTMHunt(query: string) {
  const fd = new FormData();
  fd.append("query", query);

  const res = await fetch("http://tmhunt.com/ngrams.php", {
    method: "POST",
    body: fd
  });
  if (!res.ok) throw new Error(`TMHunt HTTP ${res.status}`);
  const data = await res.json();

  const live = data.filter((x: any) => x?.[2] === "LIVE");
  const liveMarks = [...new Set(live.map((x: any) => x[1]))];

  return { liveMarks, raw: data };
}
