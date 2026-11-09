import { ACCOUNT_MENU_LABELS, ACCOUNT_MENU_PATHS } from "./nav";
import { ART_CREDITS, type ArtCredit } from "./art-credits";
import { escapeAttr, escapeHtml } from "./render-escape";

const GROUP_ORDER = [
  "game-icons",
  "kenney-ships",
  "kenney-planets",
  "kenney-sky",
  "wenrexa-buildings",
  "wenrexa-defenses",
  "nasa",
  "original",
] as const;

const GROUP_TITLE: Record<(typeof GROUP_ORDER)[number], string> = {
  "game-icons": "Research icons",
  "kenney-ships": "Ships",
  "kenney-planets": "Planet plates",
  "kenney-sky": "Galaxy backdrop",
  "wenrexa-buildings": "Buildings",
  "wenrexa-defenses": "Defenses",
  original: "Original Starhold plates",
  nasa: "Join backdrop",
};

function thumb(entry: ArtCredit): string {
  const wide = entry.group === "kenney-sky" || entry.group === "nasa";
  const width = entry.group === "kenney-sky" ? 320 : entry.group === "nasa" ? 240 : 48;
  const height = entry.group === "kenney-sky" ? 80 : entry.group === "nasa" ? 240 : 48;
  const loading = wide ? "eager" : "lazy";
  return `<img class="${wide ? "credits-wide" : "thumb"}" src="${escapeAttr(entry.path)}" alt="${escapeAttr(entry.alt)}" width="${width}" height="${height}" loading="${loading}" decoding="async" />`;
}

function entryHtml(entry: ArtCredit): string {
  return `<li class="credits-entry">
    ${thumb(entry)}
    <div>
      <p><strong>${escapeHtml(entry.alt)}</strong> <code>${escapeHtml(entry.path)}</code></p>
      <p>${escapeHtml(entry.attribution)}</p>
      <p>Author ${escapeHtml(entry.author)} · license ${escapeHtml(entry.license)} · <a href="${escapeAttr(entry.sourceUrl)}">${escapeHtml(entry.sourceUrl)}</a></p>
      <p>Source file ${escapeHtml(entry.sourceFile)}. Modified: ${escapeHtml(entry.modified)}</p>
    </div>
  </li>`;
}

/** In-game credits. Attribution text for CC BY icons is literal, not paraphrased. */
export function creditsPageHtml(): string {
  const sections = GROUP_ORDER.map((group) => {
    const rows = ART_CREDITS.filter((entry) => entry.group === group);
    if (rows.length === 0) return "";
    return `<h3>${GROUP_TITLE[group]}</h3><ul class="credits-list">${rows.map(entryHtml).join("")}</ul>`;
  }).join("");
  return `
    <section class="panel" data-testid="credits-panel">
      <h2>Credits</h2>
      <p><a href="/" data-credits-back data-testid="credits-back">Back</a></p>
      <p>Pictures in Starhold are stored with the game. The lists below are the sources, authors, and licenses.</p>
      <h3>game-icons.net</h3>
      <p data-testid="credits-game-icons">Icons made by Lorc. Available on https://game-icons.net</p>
      <p>Icons made by Delapouite. Available on https://game-icons.net</p>
      <p>Licensed under <a href="https://creativecommons.org/licenses/by/3.0/">CC BY 3.0</a> (https://creativecommons.org/licenses/by/3.0/). Modified: recolored and the full-canvas background path removed for the Starhold UI.</p>
      <h3>Kenney</h3>
      <p>Ship, planet, and sky art from Kenney (https://kenney.nl) — CC0. Attribution is not required. The Kenney logo is not used.</p>
      <h3>Wenrexa</h3>
      <p>Building and turret sprites from Wenrexa — CC0. Attribution is not required. Downloaded from the OpenGameArt page that lists CC0. The itch.io page states Creative Commons Zero.</p>
      <h3>NASA</h3>
      <p>Space photograph courtesy NASA (https://images.nasa.gov/) — Apollo 11 image AS11-44-6552, used under the NASA Media Usage Guidelines (https://www.nasa.gov/nasa-brand-center/images-and-media/). NASA does not endorse Starhold. No NASA logo is used.</p>
      <h3>Still on original plates</h3>
      <p>Capital hulls, the World Eater, swarm mothership art, shield-style defenses, Jump Gate, Chrono Lathe, Mantle Loom, Rig Foundry, the deuterium chip, and officer portraits stay on Starhold's own art or are unchanged. Galaxy slots keep the existing planet discs.</p>
      ${sections}
    </section>`;
}

export function creditsNavHtml(active: boolean, href: string): string {
  const cls = active ? "nav-link active" : "nav-link";
  return `<li><a href="${escapeAttr(href)}" class="${cls}" data-account-nav="credits" data-testid="nav-credits">${escapeHtml(ACCOUNT_MENU_LABELS.credits)}</a></li>`;
}

export function creditsHref(pathQuery: string): string {
  return `${ACCOUNT_MENU_PATHS.credits}${pathQuery}`;
}
