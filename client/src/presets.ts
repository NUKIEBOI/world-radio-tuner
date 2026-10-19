// Curated listening targets — the "good stuff" presets. Frequencies and
// modes are long-published shortwave references (UVB-76 on 4625 kHz USB
// is documented by the HF Underground wiki and the Priyom community;
// HFGCS, VOLMET, WWV/CHU and the ham watering holes are standard SWL
// references). Reception varies with time of day and solar conditions —
// treat these as where to point the dial, not a guarantee.

export type Region =
  | "North America"
  | "South America"
  | "Europe"
  | "Africa"
  | "Asia"
  | "Oceania";

export interface Preset {
  id: string;
  name: string;
  freqKhz: number;
  mode: "USB" | "LSB" | "AM" | "CW";
  category: string;
  blurb: string;
  bestRegion: Region;
  bestTime: string;
}

export const PRESETS: Preset[] = [
  {
    id: "buzzer",
    name: "The Buzzer — UVB-76",
    freqKhz: 4625,
    mode: "USB",
    category: "Numbers & markers",
    blurb:
      "A Russian military channel marker buzzing ~25 times a minute since the early 1980s. Rarely, the buzz stops and a live voice reads Russian names and number groups.",
    bestRegion: "Europe",
    bestTime: "Any time; strongest after dark",
  },
  {
    id: "pip",
    name: "The Pip",
    freqKhz: 5448,
    mode: "USB",
    category: "Numbers & markers",
    blurb:
      "A short pip, roughly once a second, from Russia's Southern Military District. Switches to 3756 kHz at night. Like The Buzzer, it occasionally carries voice traffic.",
    bestRegion: "Europe",
    bestTime: "Day frequency; try 3756 kHz at night",
  },
  {
    id: "squeaky-wheel",
    name: "The Squeaky Wheel",
    freqKhz: 5473,
    mode: "USB",
    category: "Numbers & markers",
    blurb:
      "A two-tone 'squeak' repeating from southern Russia — another channel marker in the same family as The Buzzer and The Pip. Drops to 3828 kHz after dark.",
    bestRegion: "Europe",
    bestTime: "Day frequency; 3828 kHz at night",
  },
  {
    id: "hfgcs",
    name: "HFGCS — USAF HF Network",
    freqKhz: 11175,
    mode: "USB",
    category: "Military",
    blurb:
      "The US Air Force HF Global Communications System. Listen for EAMs — long strings of letters and numbers read phonetically, broadcast to forces worldwide. Also try 8992 kHz.",
    bestRegion: "North America",
    bestTime: "Any time; busier in US daytime",
  },
  {
    id: "shannon-volmet",
    name: "Shannon VOLMET",
    freqKhz: 5505,
    mode: "USB",
    category: "Aviation weather",
    blurb:
      "A continuous loop of aviation weather for North Atlantic airfields out of Ireland — the same broadcasts transatlantic flight crews copy down en route.",
    bestRegion: "Europe",
    bestTime: "Any time; best at night on the US East Coast",
  },
  {
    id: "raf-volmet",
    name: "RAF VOLMET",
    freqKhz: 5450,
    mode: "USB",
    category: "Aviation weather",
    blurb:
      "The Royal Air Force's VOLMET loop: airfield weather for UK and European military bases, read in a measured synthesized voice.",
    bestRegion: "Europe",
    bestTime: "Any time",
  },
  {
    id: "nat-aero",
    name: "North Atlantic ATC",
    freqKhz: 5598,
    mode: "USB",
    category: "Aviation",
    blurb:
      "Oceanic air traffic control for the North Atlantic tracks — jets checking in with Gander and Shanwick, position reports and SELCAL tones over open ocean.",
    bestRegion: "North America",
    bestTime: "Evenings eastbound rush, early mornings westbound",
  },
  {
    id: "wwv",
    name: "WWV Time Signal",
    freqKhz: 10000,
    mode: "AM",
    category: "Time signals",
    blurb:
      "NIST's clock, ticking every second with a voice announcement each minute, out of Fort Collins, Colorado. Also on 5000, 15000 and 20000 kHz.",
    bestRegion: "North America",
    bestTime: "Any time; a great first catch",
  },
  {
    id: "chu",
    name: "CHU Canada",
    freqKhz: 7850,
    mode: "AM",
    category: "Time signals",
    blurb:
      "Canada's time signal from Ottawa — bilingual minute announcements over the ticks. Also on 3330 and 14670 kHz.",
    bestRegion: "North America",
    bestTime: "Any time; 3330 kHz at night",
  },
  {
    id: "ham-20m",
    name: "20-Meter Ham Band",
    freqKhz: 14250,
    mode: "USB",
    category: "Amateur radio",
    blurb:
      "The worldwide DX band. Hams from every continent work each other here in daylight; scan 14200–14300 kHz and stop on anything that sounds interesting.",
    bestRegion: "North America",
    bestTime: "Daylight hours",
  },
  {
    id: "ham-40m",
    name: "40-Meter Ham Band",
    freqKhz: 7275,
    mode: "LSB",
    category: "Amateur radio",
    blurb:
      "The evening band — regional nets and strong signals after sunset, with DX rolling in as the night deepens. Scan 7150–7300 kHz, LSB.",
    bestRegion: "North America",
    bestTime: "Evenings and night",
  },
  {
    id: "bcb-49m",
    name: "49m Broadcast Band",
    freqKhz: 6000,
    mode: "AM",
    category: "Broadcast",
    blurb:
      "International shortwave broadcasters crowd 5900–6200 kHz after dark — world news, music, and propaganda from every continent, in dozens of languages.",
    bestRegion: "North America",
    bestTime: "After dark",
  },
];
