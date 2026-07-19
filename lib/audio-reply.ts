const MARKDOWN_LINK = /\[([^\]]+)]\((https?:\/\/[^\s)]+)\)/gi;
const RAW_URL = /https?:\/\/[^\s<>"`]+/gi;

function splitTrailingPunctuation(candidate: string) {
  let url = candidate;
  let trailing = "";

  while (/[.,;:!?]$/.test(url)) {
    trailing = `${url.at(-1)}${trailing}`;
    url = url.slice(0, -1);
  }

  while (url.endsWith(")")) {
    const opening = (url.match(/\(/g) || []).length;
    const closing = (url.match(/\)/g) || []).length;
    if (closing <= opening) break;
    trailing = `)${trailing}`;
    url = url.slice(0, -1);
  }

  return { url, trailing };
}

function cleanSpokenText(value: string) {
  return value
    .replace(/^[\t ]*(?:👉|🔗|➡️?|🌐)[\t ]*$/gmu, "")
    .replace(/\(\s*\)/g, "")
    .replace(/<\s*>/g, "")
    .replace(/[\t ]+\n/g, "\n")
    .replace(/\n[\t ]+/g, "\n")
    .replace(/[\t ]{2,}/g, " ")
    .replace(/[\t ]+([.,;:!?])/g, "$1")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function splitAudioReply(value: string) {
  const links: string[] = [];
  const withMarkdownLinksRemoved = value.replace(
    MARKDOWN_LINK,
    (_match, label: string, url: string) => {
      links.push(url);
      return label;
    },
  );
  const withoutRawLinks = withMarkdownLinksRemoved.replace(RAW_URL, (candidate) => {
    const { url, trailing } = splitTrailingPunctuation(candidate);
    if (url) links.push(url);
    return trailing;
  });
  const uniqueLinks = [...new Set(links)];
  const spokenText = cleanSpokenText(withoutRawLinks) || (
    uniqueLinks.length ? "Enviei o link logo abaixo para você." : value.trim()
  );

  return {
    spokenText,
    followUpText: uniqueLinks.length
      ? uniqueLinks.map((url) => `👉 ${url}`).join("\n")
      : null,
  };
}
