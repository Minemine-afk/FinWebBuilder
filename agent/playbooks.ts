import type { Kind } from "@/lib/spec";

/**
 * Standard checklists for the topics people ask about most. A matching playbook tells the planner and the
 * research agent which categories to cover and which official sources to try first, so a vague prompt like
 * "renovation costs" still gets the usual parts. Plain data with no Node imports, so the site can use it too.
 */
export interface Playbook {
  id: string;
  title: string;
  /** Words in a topic that point to this playbook. */
  keywords: string[];
  /** The calculator kind that usually fits. */
  kind: Kind;
  /** The categories or options a good calculator on this topic covers. */
  checklist: string[];
  /** Where to look first, in order. Official sources before secondary ones. */
  sources: { name: string; site: string; official: boolean; use: string }[];
  /** Things people forget that change the answer. */
  watchFor: string[];
  /** Fewest options, lines or items a calculator on this topic should have. */
  minItems: number;
}

export const PLAYBOOKS: Playbook[] = [
  {
    id: "property",
    title: "Property prices and buying a home",
    keywords: ["property", "hdb", "condo", "resale", "bto", "landed", "house price", "home price", "mortgage", "flat"],
    kind: "projection",
    checklist: ["HDB resale by town and flat type (3-room to executive)", "Private condominium by region (CCR, RCR, OCR)", "Landed property", "BTO or new-launch price", "Buyer's stamp duty, and additional duty where it applies", "Home loan: HDB loan versus bank loan, and the TDSR limit"],
    sources: [
      { name: "HDB resale transactions (data.gov.sg)", site: "data.gov.sg", official: true, use: "Use `npx tsx agent/datasets.ts hdb-resale`; do not research HDB prices by hand." },
      { name: "URA private property price indices (SingStat)", site: "singstat.gov.sg", official: true, use: "Use `npx tsx agent/datasets.ts private-index` for past private prices." },
      { name: "IRAS stamp duty rates", site: "iras.gov.sg", official: true, use: "Buyer's and additional buyer's stamp duty." },
      { name: "MAS TDSR and loan-to-value rules", site: "mas.gov.sg", official: true, use: "Loan limits." },
    ],
    watchFor: ["Price per town differs widely; show the town, not one island-wide figure", "Lease remaining changes resale prices", "Future prices should use the compound yearly rate of the last three years"],
    minItems: 10,
  },
  {
    id: "renovation",
    title: "Home renovation costs",
    keywords: ["renovation", "renovate", "reno", "interior design", "contractor", "kitchen", "bathroom", "carpentry", "refurbish"],
    kind: "estimate",
    checklist: ["Hacking and demolition", "Flooring and wall tiles", "Carpentry (wardrobes, cabinets, TV console)", "Electrical and lighting", "Plumbing and bathroom fittings", "Painting", "False ceiling", "Doors and windows", "Kitchen cabinets and countertop", "Air-conditioning", "Cleaning and disposal", "Permits and management fees", "Interior design firm versus contractor versus design-and-build"],
    sources: [
      { name: "HDB renovation guidelines and permit rules", site: "hdb.gov.sg", official: true, use: "What needs a permit, working hours, and rules for hacking." },
      { name: "CASE Trust (accredited firms)", site: "case.org.sg", official: false, use: "Which providers are accredited." },
      { name: "Provider price lists and packages", site: "provider sites", official: false, use: "Package prices by flat type, with archived copies for past years." },
      { name: "Qanvast, Hometrust and similar listings", site: "qanvast.com / hometrust.sg", official: false, use: "Quotes and dated reviews." },
    ],
    watchFor: ["Price depends on floor area and flat type; make area an input", "BTO, resale and condo jobs need different lines", "Add a contingency buffer"],
    minItems: 10,
  },
  {
    id: "travel",
    title: "Trips and travel",
    keywords: ["trip", "travel", "holiday", "vacation", "flight", "hotel", "tour", "visit", "itinerary", "japan", "korea", "thailand", "bali", "europe"],
    kind: "compare",
    checklist: ["Return flights from Singapore, low cost and full service", "Accommodation per night at budget, mid and upper level", "Local transport and airport transfers", "Food per day", "Attractions and activities", "Travel insurance", "Visa or entry fee, if any", "Mobile data and roaming", "Currency exchange costs"],
    sources: [
      { name: "Airline and airport websites", site: "airline sites", official: true, use: "Published fares and baggage fees." },
      { name: "Government visa and entry pages", site: "destination government sites", official: true, use: "Visa and entry fees." },
      { name: "MAS exchange rates", site: "mas.gov.sg", official: true, use: "Convert foreign prices to SGD; state the rate used." },
      { name: "Hotel booking sites", site: "booking sites", official: false, use: "Nightly rates; state the month priced." },
    ],
    watchFor: ["Peak and off-peak months differ a lot; state the month priced", "Convert foreign prices at a stated exchange rate", "Say how many travellers the totals cover"],
    minItems: 3,
  },
  {
    id: "cars",
    title: "Cars and car ownership",
    keywords: ["car", "coe", "ev", "electric vehicle", "petrol", "hybrid", "motorcycle", "vehicle", "tesla", "byd", "toyota", "road tax", "erp"],
    kind: "compare",
    checklist: ["Purchase price including COE", "Additional registration fee (ARF) and open market value", "Road tax", "Insurance", "Fuel or charging", "Servicing and maintenance", "Parking and ERP", "Loan interest", "Resale or scrap value after the COE period"],
    sources: [
      { name: "LTA COE bidding results and vehicle taxes", site: "lta.gov.sg / data.gov.sg", official: true, use: "COE premium, ARF and road tax." },
      { name: "Dealer price lists", site: "dealer sites", official: false, use: "List prices; check what the price includes." },
      { name: "Energy and charging tariffs", site: "provider sites", official: false, use: "Electricity and public charging rates." },
    ],
    watchFor: ["A COE lasts ten years, so compare over the same period", "State annual distance; fuel and charging scale with it", "Category A and B COE differ"],
    minItems: 3,
  },
  {
    id: "education",
    title: "Education and tuition",
    keywords: ["university", "tuition", "school fees", "education", "course", "degree", "polytechnic", "nus", "ntu", "smu", "childcare", "preschool", "student"],
    kind: "estimate",
    checklist: ["Tuition fees per year by programme", "Hostel or accommodation", "Books and materials", "Miscellaneous and student fees", "Grants and subsidies for citizens, PRs and international students", "Living costs", "Fee increases over the years"],
    sources: [
      { name: "MOE fee schedules", site: "moe.gov.sg", official: true, use: "School and tuition grant fees." },
      { name: "University fee pages", site: "university sites", official: true, use: "Per-programme fees, by student category." },
      { name: "SkillsFuture and CPF Edusave", site: "skillsfuture.gov.sg / cpf.gov.sg", official: true, use: "Credits and subsidies." },
    ],
    watchFor: ["Fees depend on citizenship status; make it a choice", "Fees rise most years; show the cohort year", "Say which intake year the fees apply to"],
    minItems: 6,
  },
];

/** The playbook whose keywords match the topic best, or null. A keyword counts once, longer ones first. */
export function findPlaybook(topic: string): Playbook | null {
  const text = ` ${topic.toLowerCase()} `;
  let best: { playbook: Playbook; score: number } | null = null;
  for (const playbook of PLAYBOOKS) {
    const score = playbook.keywords.filter((k) => new RegExp(`\\b${k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`).test(text)).length;
    if (score > 0 && (!best || score > best.score)) best = { playbook, score };
  }
  return best?.playbook ?? null;
}

export function getPlaybook(id: string | null | undefined): Playbook | null {
  return PLAYBOOKS.find((p) => p.id === id) ?? null;
}

/** The playbook as prompt text for the research agent. */
export function playbookPrompt(p: Playbook): string {
  return `Playbook for "${p.title}" (the usual shape of this topic; adapt it to the request, and skip what clearly doesn't apply):
Cover: ${p.checklist.join("; ")}.
Look first at: ${p.sources.map((s) => `${s.name}${s.official ? " [official]" : ""}: ${s.use}`).join(" | ")}
Watch for: ${p.watchFor.join("; ")}.
Unless the request asks for fewer, include at least ${p.minItems} options, lines or items.`;
}
