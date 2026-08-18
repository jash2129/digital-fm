// Small curated icon set for coverage bullets, picked by keyword match against the bullet text
// (which comes from pricing.json — editable content, not hardcoded per-bullet icon assignments).
// Falls back to a generic checkmark when nothing matches, so editing pricing.json never breaks
// this — worst case a bullet just gets the generic icon instead of a specific one.

type IconName =
  | "engine"
  | "wheel"
  | "steering"
  | "electrical"
  | "cooling"
  | "wrench"
  | "dollar"
  | "droplet"
  | "filter"
  | "calendar"
  | "shield"
  | "check";

const KEYWORD_ICON_MAP: Array<{ keywords: string[]; icon: IconName }> = [
  { keywords: ["engine", "transmission", "axle", "drive"], icon: "engine" },
  { keywords: ["tire", "wheel", "rim"], icon: "wheel" },
  { keywords: ["suspension", "steering", "brake"], icon: "steering" },
  { keywords: ["electrical", "high-tech", "accessor"], icon: "electrical" },
  { keywords: ["air conditioning", "cooling"], icon: "cooling" },
  { keywords: ["labor", "service", "maintenance"], icon: "wrench" },
  { keywords: ["deductible", "balance", "cost", "no out-of-pocket"], icon: "dollar" },
  { keywords: ["oil"], icon: "droplet" },
  { keywords: ["filter"], icon: "filter" },
  { keywords: ["rotation", "5 year", "years", "scheduled"], icon: "calendar" },
  { keywords: ["gap", "totaled", "stolen", "accident", "theft", "hail", "flood", "fire", "cover"], icon: "shield" },
];

function pickIcon(bulletText: string): IconName {
  const normalized = bulletText.toLowerCase();
  const match = KEYWORD_ICON_MAP.find(({ keywords }) =>
    keywords.some((keyword) => normalized.includes(keyword)),
  );
  return match?.icon ?? "check";
}

const ICON_PATHS: Record<IconName, string> = {
  engine: "M4 8h4l2-3h6l2 3h4v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8zM9 12h6M9 16h6",
  wheel: "M12 12m-8 0a8 8 0 1 0 16 0a8 8 0 1 0-16 0 M12 12m-2.5 0a2.5 2.5 0 1 0 5 0a2.5 2.5 0 1 0-5 0 M12 4v3M12 17v3M4.9 7.1l2.1 2.1M17 14.8l2.1 2.1M4.9 16.9l2.1-2.1M17 9.2l2.1-2.1",
  steering: "M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0-18 0 M12 12m-2 0a2 2 0 1 0 4 0a2 2 0 1 0-4 0 M12 3v7M6.3 17.5l4.5-3.2M17.7 17.5l-4.5-3.2",
  electrical: "M13 2 4 14h6l-1 8 9-12h-6l1-8z",
  cooling: "M12 2v20M4.9 6.9l14.2 10.2M4.9 17.1 19.1 6.9M6 12h12M8 3.5l4 3.5 4-3.5M8 20.5l4-3.5 4 3.5",
  wrench: "M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18v3h3l6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2-2 2.5-2.5z",
  dollar: "M12 2v20M17 6.5c0-1.9-2.2-3.5-5-3.5s-5 1.4-5 3.5S9.2 10 12 10s5 1.6 5 3.5-2.2 3.5-5 3.5-5-1.6-5-3.5",
  droplet: "M12 2s6 7.5 6 12a6 6 0 1 1-12 0c0-4.5 6-12 6-12z",
  filter: "M3 4h18l-7 9v6l-4 2v-8L3 4z",
  calendar: "M4 5h16v16H4V5zM4 9h16M8 3v4M16 3v4",
  shield: "M12 2 4 5v6c0 5 3.4 8.7 8 11 4.6-2.3 8-6 8-11V5l-8-3z",
  check: "M20 6 9 17l-5-5",
};

export function CoverageIcon({ bulletText, className }: { bulletText: string; className?: string }) {
  const icon = pickIcon(bulletText);

  return (
    <svg
      className={className}
      fill="none"
      height="16"
      viewBox="0 0 24 24"
      width="16"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d={ICON_PATHS[icon]}
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
      />
    </svg>
  );
}