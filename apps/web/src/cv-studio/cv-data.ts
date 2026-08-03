export type Experience = { role: string; company: string; date: string; place: string; description: string };
export type Education = { degree: string; school: string; date: string; place: string };

/** Available page designs. Order here drives the template picker. */
export type TemplateKey =
	| "classic"
	| "minimal"
	| "onyx"
	| "glalie"
	| "rhyhorn"
	| "azurill"
	| "scizor"
	| "lapras"
	| "sidebar"
	| "gengar"
	| "meowth"
	| "kakuna"
	| "pikachu"
	| "leafish"
	| "bronzor"
	| "ditto";

export const TEMPLATES: { key: TemplateKey; label: string }[] = [
	{ key: "classic", label: "Classique premium" },
	{ key: "minimal", label: "Minimaliste" },
	{ key: "onyx", label: "Lignes classiques" },
	{ key: "glalie", label: "Centré épuré" },
	{ key: "rhyhorn", label: "Filet & photo à droite" },
	{ key: "azurill", label: "Timeline" },
	{ key: "scizor", label: "Bandeau plein" },
	{ key: "lapras", label: "Bandeau doux" },
	{ key: "sidebar", label: "Colonne latérale" },
	{ key: "gengar", label: "Latérale douce" },
	{ key: "meowth", label: "Latérale à droite" },
	{ key: "kakuna", label: "Latérale douce à droite" },
	{ key: "pikachu", label: "Bandeau coloré" },
	{ key: "leafish", label: "Bandeaux teintés" },
	{ key: "bronzor", label: "Bandeau doux 2 colonnes" },
	{ key: "ditto", label: "Bannière centrée" },
];

/** Templates that use the two-column (accent sidebar / banded) layout. */
export const TWO_COLUMN_TEMPLATES: TemplateKey[] = [
	"sidebar",
	"gengar",
	"meowth",
	"kakuna",
	"pikachu",
	"leafish",
	"bronzor",
	"ditto",
];

/**
 * Templates with a PERMANENT side column (the accent/tinted sidebar always shows its pinned
 * photo + contacts, so its width always matters). Banded templates instead only reserve a side
 * column when the user has actually placed sections in it.
 */
export const SIDEBAR_STRUCTURE_TEMPLATES: TemplateKey[] = ["sidebar", "gengar", "meowth", "kakuna"];

/**
 * Single-column templates whose PDF text extracts in a clean, linear reading order — the safest
 * choice for recruiting ATS parsers. The two-column templates look nicer but interleave the two
 * columns in the text stream, which some ATS mis-parse.
 */
export const isAtsFriendly = (template: TemplateKey): boolean => !TWO_COLUMN_TEMPLATES.includes(template);

/** The draggable content blocks. The header (name/photo/contacts) is fixed and not a section. */
export type SectionId = "profile" | "experiences" | "education" | "skills" | "languages" | "interests";

/** All sections in their canonical order — used to seed a layout and to fill in any missing ids. */
export const SECTION_ORDER: SectionId[] = ["profile", "experiences", "education", "skills", "languages", "interests"];

export const SECTION_LABELS: Record<SectionId, string> = {
	profile: "Profil",
	experiences: "Expériences",
	education: "Formation",
	skills: "Compétences",
	languages: "Langues",
	interests: "Intérêts",
};

/** One physical page: sections assigned to the main column and (sidebar template only) the side column. */
export type PageLayout = { main: SectionId[]; sidebar: SectionId[] };

/** Explicit multi-page layout — the user decides which section lands on which page/column. */
export type Layout = { sidebarWidth: number; pages: PageLayout[] };

/**
 * Per-section page-break behaviour:
 * - "flow"    : may be split across a page boundary (individual entries still never cut in two)
 * - "keep"    : stays whole — jumps to the next page rather than being split (react-pdf `wrap={false}`)
 * - "newpage" : always starts at the top of a new page (react-pdf `break`)
 */
export type SectionBreakMode = "flow" | "keep" | "newpage";
export type SectionOptions = { mode: SectionBreakMode };

export const SECTION_BREAK_LABELS: { value: SectionBreakMode; label: string }[] = [
	{ value: "flow", label: "Couper" },
	{ value: "keep", label: "Grouper" },
	{ value: "newpage", label: "Nouvelle page" },
];

export type CV = {
	name: string;
	title: string;
	email: string;
	phone: string;
	city: string;
	nationality: string;
	age: string;
	permis: string;
	photo: string;
	profile: string;
	skills: string;
	languages: string;
	interests: string;
	experiences: Experience[];
	education: Education[];
	accent: string;
	template: TemplateKey;
	showIcons: boolean;
	iconColor: string;
	layout: Layout;
	sectionOptions: Record<SectionId, SectionOptions>;
};

/**
 * Default per-section options. Entry-list sections that can grow long (profil, expériences,
 * formation) flow across pages so they fill the space — individual entries never split. The short
 * blocks (compétences, langues, intérêts) stay whole to avoid an awkward tail on the next page.
 */
const FLOW_BY_DEFAULT: SectionId[] = ["profile", "experiences", "education"];
export const defaultSectionOptions = (): Record<SectionId, SectionOptions> =>
	Object.fromEntries(
		SECTION_ORDER.map((id) => [id, { mode: FLOW_BY_DEFAULT.includes(id) ? "flow" : "keep" }]),
	) as Record<SectionId, SectionOptions>;

/** Coerce stored section options to the current shape (migrates the legacy `{ keepTogether }` flag). */
export const normalizeSectionOptions = (
	stored: Partial<Record<SectionId, { mode?: SectionBreakMode; keepTogether?: boolean }>> | undefined,
): Record<SectionId, SectionOptions> => {
	const result = defaultSectionOptions();
	if (stored) {
		for (const id of SECTION_ORDER) {
			const option = stored[id];
			if (!option) continue;
			if (option.mode === "flow" || option.mode === "keep" || option.mode === "newpage")
				result[id] = { mode: option.mode };
			else if (typeof option.keepTogether === "boolean") result[id] = { mode: option.keepTogether ? "keep" : "flow" };
		}
	}
	return result;
};

/** Every section present, split into main/sidebar the way the classic sidebar template does. */
export const defaultLayout = (): Layout => ({
	sidebarWidth: 34,
	pages: [{ main: ["profile", "experiences", "education"], sidebar: ["skills", "languages", "interests"] }],
});

/** All section ids currently placed anywhere in the layout (main + sidebar across every page). */
export const placedSections = (layout: Layout): SectionId[] =>
	layout.pages.flatMap((page) => [...page.main, ...page.sidebar]);

/**
 * Repair a (possibly missing/partial) layout so it always contains exactly the canonical section
 * set: drop unknown/duplicate ids and append any missing ones to the last page's main column.
 * Guarantees at least one page. Safe to call on legacy data that predates the layout field.
 */
export const normalizeLayout = (layout: Layout | undefined): Layout => {
	const base = layout ?? defaultLayout();
	const seen = new Set<SectionId>();
	const keep = (ids: SectionId[] = []) =>
		ids.filter((id) => {
			if (!SECTION_ORDER.includes(id) || seen.has(id)) return false;
			seen.add(id);
			return true;
		});
	const pages = (base.pages?.length ? base.pages : [{ main: [], sidebar: [] }]).map((page) => ({
		main: keep(page.main),
		sidebar: keep(page.sidebar),
	}));
	const missing = SECTION_ORDER.filter((id) => !seen.has(id));
	if (missing.length > 0) pages[pages.length - 1].main.push(...missing);
	const width = Number.isFinite(base.sidebarWidth) ? base.sidebarWidth : 34;
	return { sidebarWidth: Math.max(10, Math.min(50, Math.round(width))), pages };
};

/** Fill in the layout + per-section options for any CV (including legacy data missing these fields). */
export const hydrateCv = (cv: CV): CV => ({
	...cv,
	layout: normalizeLayout(cv.layout),
	sectionOptions: normalizeSectionOptions(cv.sectionOptions),
});

export const storageKey = "cv-studio-standalone-v2";

export const sample: CV = {
	name: "Prénom NOM",
	title: "Commerciale B2B",
	email: "email@example.com",
	phone: "+33 0 00 00 00 00",
	city: "Île-de-France",
	nationality: "Française",
	age: "29 ans",
	permis: "Permis B",
	photo: "",
	profile:
		"Commerciale orientée développement et fidélisation, avec une expérience en vente B2B, gestion de comptes clients, appels d'offres et outils CRM. Organisée, autonome et dotée d'un excellent relationnel.",
	skills:
		"Prospection multicanale\nNégociation commerciale\nGestion du cycle de vente\nFidélisation client\nRéponse aux appels d'offres\nCRM, Excel, Office",
	languages: "Français | langue maternelle | 5\nAnglais | courant | 4\nAllemand | notions professionnelles | 2",
	interests: "Théâtre\nSport\nEngagement associatif",
	experiences: [
		{
			role: "Commerciale",
			company: "Entreprise A",
			date: "2024 – 2025",
			place: "Paris",
			description:
				"Prospection client, fidélisation, propositions commerciales, négociation, suivi des contrats et gestion CRM.",
		},
		{
			role: "Assistante commerciale",
			company: "Entreprise B",
			date: "2019 – 2022",
			place: "Nanterre",
			description:
				"Renouvellement de contrats, ventes additionnelles, gestion de base de données, relances et coordination administrative.",
		},
	],
	education: [
		{ degree: "Master Négociation Commerciale Internationale", school: "Université", date: "2014", place: "Paris" },
		{ degree: "BTS Commerce International", school: "Lycée", date: "2011", place: "Île-de-France" },
	],
	accent: "#123047",
	template: "sidebar",
	showIcons: true,
	iconColor: "",
	layout: defaultLayout(),
	sectionOptions: defaultSectionOptions(),
};

export const lines = (value: string) =>
	value
		.split("\n")
		.map((item) => item.trim())
		.filter(Boolean);

/**
 * Parse a language line "Name | level | note(1-5)". The note is optional and,
 * when present, drives the visual proficiency dots. Anything after the 2nd pipe
 * that is not a 1-5 number is folded back into the textual level.
 */
export const parseLanguage = (line: string) => {
	const [name = "", level = "", note = ""] = line.split("|").map((item) => item.trim());
	const parsed = Number(note);
	const dots = note !== "" && Number.isFinite(parsed) ? Math.max(0, Math.min(5, Math.round(parsed))) : 0;
	const extraLevel = note !== "" && dots === 0 ? ` ${note}` : "";
	return { name, level: `${level}${extraLevel}`.trim(), dots };
};

export type ContactKey = "email" | "phone" | "city" | "nationality" | "age" | "permis";

/** Contact fields in display order (typed, so each can carry its own icon), empties removed. */
export const contactItems = (cv: CV): { key: ContactKey; value: string }[] =>
	(
		[
			["email", cv.email],
			["phone", cv.phone],
			["city", cv.city],
			["nationality", cv.nationality],
			["age", cv.age],
			["permis", cv.permis],
		] as [ContactKey, string][]
	)
		.filter(([, value]) => value)
		.map(([key, value]) => ({ key, value }));

/** Contact fields in display order, empties removed. Shared by preview + PDF. */
export const contactValues = (cv: CV) => contactItems(cv).map((item) => item.value);

/** Curated accent presets for the colour palette. */
export const PALETTE = ["#123047", "#1f3a5f", "#0f3d3e", "#264d3b", "#7a1f2b", "#4a2c5a", "#3a2e39", "#2b2f33"];
