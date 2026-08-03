import type { ComponentProps, ReactNode } from "react";
import type { ContactKey, CV, PageLayout, SectionBreakMode, SectionId } from "./cv-data";
import { Circle, Document, Font, Image, Page, Path, StyleSheet, Svg, Text, View } from "@react-pdf/renderer";
import { contactItems, lines, normalizeLayout, parseLanguage, SECTION_LABELS } from "./cv-data";

// Keep words whole (no mid-word hyphenation) so ATS keyword matching isn't broken by "négocia-tion".
Font.registerHyphenationCallback((word) => [word]);

/** react-pdf's Style type, derived from the Page style prop (avoids depending on @react-pdf/types). */
type Style = NonNullable<ComponentProps<typeof Page>["style"]>;

const A4_WIDTH = 595.28;
const A4_HEIGHT = 841.89;

const ICON_STROKE = { strokeWidth: 2, fill: "none", strokeLinecap: "round", strokeLinejoin: "round" } as const;

/** Blend a hex colour toward white by `alpha` (1 = full colour, 0 = white). Returns a solid rgb(). */
const tint = (hex: string, alpha: number): string => {
	const clean = hex.replace("#", "");
	const full =
		clean.length === 3
			? clean
					.split("")
					.map((c) => c + c)
					.join("")
			: clean;
	const num = Number.parseInt(full || "123047", 16);
	const mix = (channel: number) => Math.round(channel * alpha + 255 * (1 - alpha));
	return `rgb(${mix((num >> 16) & 255)},${mix((num >> 8) & 255)},${mix(num & 255)})`;
};

/** Small line icon drawn per contact field (email/phone/city/nationality/age). */
const ContactIcon = ({ name, color, size = 9 }: { name: ContactKey; color: string; size?: number }) => (
	<Svg width={size} height={size} viewBox="0 0 24 24" style={{ marginTop: 1 }}>
		{name === "email" && (
			<>
				<Path d="M3 5.5h18v13H3z" stroke={color} {...ICON_STROKE} />
				<Path d="M3 6.5l9 6.5 9-6.5" stroke={color} {...ICON_STROKE} />
			</>
		)}
		{name === "phone" && (
			<Path
				d="M22 16.9v3a2 2 0 0 1-2.2 2A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.13 1 .35 1.9.66 2.8a2 2 0 0 1-.45 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.45c.9.3 1.85.53 2.8.66a2 2 0 0 1 1.7 2z"
				stroke={color}
				{...ICON_STROKE}
			/>
		)}
		{name === "city" && (
			<>
				<Path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0z" stroke={color} {...ICON_STROKE} />
				<Circle cx={12} cy={10} r={2.6} stroke={color} {...ICON_STROKE} />
			</>
		)}
		{name === "nationality" && (
			<>
				<Circle cx={12} cy={12} r={9} stroke={color} {...ICON_STROKE} />
				<Path d="M3 12h18" stroke={color} {...ICON_STROKE} />
				<Path d="M12 3c2.6 2.7 2.6 15.3 0 18c-2.6-2.7-2.6-15.3 0-18z" stroke={color} {...ICON_STROKE} />
			</>
		)}
		{name === "age" && (
			<>
				<Path d="M5 6.5h14v13H5z" stroke={color} {...ICON_STROKE} />
				<Path d="M5 10.5h14" stroke={color} {...ICON_STROKE} />
				<Path d="M9 3.5v4M15 3.5v4" stroke={color} {...ICON_STROKE} />
			</>
		)}
		{name === "permis" && (
			<>
				<Path d="M6 13l1.4-3.8a2 2 0 0 1 1.88-1.3h5.44a2 2 0 0 1 1.88 1.3L18 13" stroke={color} {...ICON_STROKE} />
				<Path d="M4.5 13h15v4a1 1 0 0 1-1 1H5.5a1 1 0 0 1-1-1z" stroke={color} {...ICON_STROKE} />
				<Circle cx={8} cy={18} r={1.6} stroke={color} {...ICON_STROKE} />
				<Circle cx={16} cy={18} r={1.6} stroke={color} {...ICON_STROKE} />
			</>
		)}
	</Svg>
);

/** Row of 5 proficiency dots (filled up to `count`). */
const Dots = ({ count, filled, empty }: { count: number; filled: string; empty: string }) => (
	<View style={{ flexDirection: "row", marginTop: 3 }}>
		{[1, 2, 3, 4, 5].map((i) => (
			<View
				key={i}
				style={{ width: 5, height: 5, borderRadius: 2.5, marginRight: 3, backgroundColor: i <= count ? filled : empty }}
			/>
		))}
	</View>
);

/** Subtle "wallpaper" dot grid painted over a coloured sidebar background. */
const patternDots = (width: number) => {
	const dots = [];
	for (let y = 16; y < A4_HEIGHT; y += 15) {
		for (let x = 10; x < width; x += 15) {
			dots.push(<Circle key={`${x}-${y}`} cx={x} cy={y} r={1.1} fill="#ffffff" fillOpacity={0.06} />);
		}
	}
	return dots;
};

const shared = StyleSheet.create({
	name: { fontSize: 24, fontWeight: 700, marginBottom: 2, letterSpacing: -0.3 },
	role: { fontSize: 12, fontWeight: 400, marginBottom: 2 },
});

// ---------------------------------------------------------------------------
// Column styling — one parameterised factory drives every template's columns.
// ---------------------------------------------------------------------------

type ColumnConfig = {
	side: boolean; // narrow sidebar column? (changes languages/interests layout)
	text: string; // body / description text colour
	muted: string; // meta line colour
	title: string; // section-title text colour
	rule?: string; // section-title underline colour (omit for no rule)
	ruleWide?: boolean; // draw the rule as a full-width hairline under the title (traditional look)
	heading: string; // entry-title colour
	tagBg: string;
	tagText: string;
	dotFilled: string;
	dotEmpty: string;
	langBorder: string; // divider under a language row (main variant only)
	entryBar?: string; // when set, draws a vertical accent bar down the left of each entry (timeline look)
};

const makeColumn = (c: ColumnConfig) => ({
	cfg: c,
	styles: StyleSheet.create({
		titleWrap: { marginTop: c.side ? 16 : 13, marginBottom: c.side ? 7 : 6 },
		titleText: { fontSize: c.side ? 9 : 9.5, letterSpacing: 0.7, color: c.title, fontWeight: 700 },
		profile: {
			fontFamily: "Times-Italic",
			fontSize: c.side ? 9.5 : 11,
			color: c.side ? c.text : "#3e4c59",
			lineHeight: 1.5,
		},
		item: c.entryBar
			? { marginBottom: 9, borderLeftWidth: 2, borderLeftColor: c.entryBar, paddingLeft: 11 }
			: { marginBottom: 8 },
		itemTitle: { fontSize: c.side ? 9.5 : 11, fontWeight: 700, color: c.heading, marginBottom: 1.5 },
		itemMeta: { fontSize: 9, color: c.muted, marginBottom: 2.5 },
		itemText: { fontSize: c.side ? 9 : 10, color: c.text, lineHeight: 1.4 },
		tagRow: { flexDirection: "row", flexWrap: "wrap", gap: 4, marginTop: 1 },
		tag: {
			backgroundColor: c.tagBg,
			borderRadius: 8,
			paddingHorizontal: 7,
			paddingVertical: 4,
			marginBottom: 4,
			alignItems: "center",
			justifyContent: "center",
		},
		tagText: { color: c.tagText, fontSize: c.side ? 8.5 : 9, lineHeight: 1 },
		langRow: {
			flexDirection: "row",
			justifyContent: "space-between",
			alignItems: "center",
			borderBottomWidth: 1,
			borderBottomColor: c.langBorder,
			paddingBottom: 3.5,
			marginBottom: 3.5,
		},
		langBlock: { marginBottom: 11 },
		langName: { fontSize: 9.5, fontWeight: 700, color: c.heading, marginBottom: 1.5 },
		langLevel: { fontSize: 9, color: c.muted },
		interest: { fontSize: c.side ? 9.5 : 10, color: c.text, marginBottom: 4 },
	}),
});

type Column = ReturnType<typeof makeColumn>;

const SectionTitle = ({ label, col }: { label: string; col: Column }) => (
	<View style={col.styles.titleWrap} minPresenceAhead={46}>
		<Text style={col.styles.titleText}>{label.toUpperCase()}</Text>
		{col.cfg.rule ? (
			col.cfg.ruleWide ? (
				<View style={{ height: 1, backgroundColor: col.cfg.rule, marginTop: 4 }} />
			) : (
				<View style={{ width: 24, height: 2, backgroundColor: col.cfg.rule, borderRadius: 1, marginTop: 4 }} />
			)
		) : null}
	</View>
);

const SectionContent = ({ id, cv, col }: { id: SectionId; cv: CV; col: Column }) => {
	const s = col.styles;
	switch (id) {
		case "profile":
			return <Text style={s.profile}>{cv.profile}</Text>;
		case "experiences":
			return (
				<>
					{cv.experiences.map((item, index) => (
						<View key={index} style={s.item} wrap={false}>
							<Text style={s.itemTitle}>
								{item.role} — {item.company}
							</Text>
							<Text style={s.itemMeta}>{[item.date, item.place].filter(Boolean).join(" · ")}</Text>
							{item.description ? <Text style={s.itemText}>{item.description}</Text> : null}
						</View>
					))}
				</>
			);
		case "education":
			return (
				<>
					{cv.education.map((item, index) => (
						<View key={index} style={s.item} wrap={false}>
							<Text style={s.itemTitle}>{item.degree}</Text>
							<Text style={s.itemMeta}>{[item.school, item.date, item.place].filter(Boolean).join(" · ")}</Text>
						</View>
					))}
				</>
			);
		case "skills":
			return (
				<View style={s.tagRow}>
					{lines(cv.skills).map((skill) => (
						<View key={skill} style={s.tag}>
							<Text style={s.tagText}>{skill}</Text>
						</View>
					))}
				</View>
			);
		case "languages":
			return col.cfg.side
				? lines(cv.languages).map((line) => {
						const lang = parseLanguage(line);
						return (
							<View key={line} style={s.langBlock} wrap={false}>
								<Text style={s.langName}>{lang.name}</Text>
								{lang.level ? <Text style={s.langLevel}>{lang.level}</Text> : null}
								{lang.dots > 0 && <Dots count={lang.dots} filled={col.cfg.dotFilled} empty={col.cfg.dotEmpty} />}
							</View>
						);
					})
				: lines(cv.languages).map((line) => {
						const lang = parseLanguage(line);
						return (
							<View key={line} style={s.langRow} wrap={false}>
								<Text style={s.itemTitle}>{lang.name}</Text>
								<View style={{ alignItems: "flex-end" }}>
									{lang.level ? <Text style={s.itemMeta}>{lang.level}</Text> : null}
									{lang.dots > 0 && <Dots count={lang.dots} filled={col.cfg.dotFilled} empty={col.cfg.dotEmpty} />}
								</View>
							</View>
						);
					});
		case "interests":
			return col.cfg.side ? (
				lines(cv.interests).map((interest) => (
					<Text key={interest} style={s.interest}>
						• {interest}
					</Text>
				))
			) : (
				<Text style={s.interest}>{lines(cv.interests).join("   ·   ")}</Text>
			);
	}
};

/** A section = its title + body, with per-section page-break behaviour (flow / keep whole / new page). */
const SectionBlock = ({
	id,
	cv,
	col,
	mode,
	allowBreak,
}: {
	id: SectionId;
	cv: CV;
	col: Column;
	mode: SectionBreakMode;
	allowBreak: boolean;
}) => (
	<View wrap={mode !== "keep"} break={mode === "newpage" && allowBreak ? true : undefined}>
		<SectionTitle label={SECTION_LABELS[id]} col={col} />
		<SectionContent id={id} cv={cv} col={col} />
	</View>
);

const Sections = ({
	ids,
	cv,
	col,
	firstOnPage = false,
	allowNewPage = true,
}: {
	ids: SectionId[];
	cv: CV;
	col: Column;
	firstOnPage?: boolean;
	allowNewPage?: boolean;
}) => (
	<>
		{ids.map((id, index) => (
			<SectionBlock
				key={id}
				id={id}
				cv={cv}
				col={col}
				mode={cv.sectionOptions?.[id]?.mode ?? "flow"}
				// Never force a break on the very first section of page 1 (would leave a blank first page),
				// and disable "new page" inside the narrow side columns where it renders awkwardly.
				allowBreak={allowNewPage && !(firstOnPage && index === 0)}
			/>
		))}
	</>
);

// ---------------------------------------------------------------------------
// Header pieces
// ---------------------------------------------------------------------------

const ContactList = ({
	cv,
	color,
	iconColor,
	dividerColor,
	center,
}: {
	cv: CV;
	color: string;
	iconColor: string;
	dividerColor?: string;
	center?: boolean;
}) => (
	<View
		style={{
			flexDirection: "row",
			flexWrap: "wrap",
			alignItems: "center",
			justifyContent: center ? "center" : "flex-start",
			marginTop: 5,
		}}
	>
		{contactItems(cv).map((item, index) => (
			<View key={item.key} style={{ flexDirection: "row", alignItems: "center", marginRight: 10, marginBottom: 3 }}>
				{dividerColor && index > 0 ? (
					<Text style={{ color: dividerColor, fontSize: 9, marginRight: 10 }}>|</Text>
				) : null}
				{cv.showIcons && <ContactIcon name={item.key} color={iconColor} size={8.5} />}
				<Text style={{ fontSize: 9.5, color, marginLeft: cv.showIcons ? 4 : 0, lineHeight: 1 }}>{item.value}</Text>
			</View>
		))}
	</View>
);

// ---------------------------------------------------------------------------
// Template definition
// ---------------------------------------------------------------------------

type Template = {
	structure: "single" | "sidebar" | "banded" | "topband";
	page: Style;
	main: Column;
	side: Column;
	/** header rendered in the main content area (page 1). */
	Header: () => ReactNode;
	/** pinned photo + contacts at the top of the accent sidebar (sidebar structure). */
	SideHeader?: () => ReactNode;
	/** full-width banner across the top (banded / topband structures). */
	Banner?: () => ReactNode;
	/** padded body container for the single column under a topband banner. */
	body?: Style;
	sideBg?: string; // sidebar structure: accent column background
	sideOnLeft?: boolean; // sidebar/banded: which side the narrow column sits (default left)
};

const resolveTemplate = (cv: CV): Template => {
	const accent = cv.accent || "#123047";
	const lightMain = makeColumn({
		side: false,
		text: "#27364a",
		muted: "#7b8794",
		title: accent,
		rule: accent,
		heading: "#1f2933",
		tagBg: "#eef2f6",
		tagText: "#3e4c59",
		dotFilled: accent,
		dotEmpty: "#dde3ea",
		langBorder: "#f0f2f5",
	});
	const accentSide = makeColumn({
		side: true,
		text: "rgba(255,255,255,0.88)",
		muted: "rgba(255,255,255,0.7)",
		title: "#ffffff",
		rule: "rgba(255,255,255,0.55)",
		heading: "#ffffff",
		tagBg: "rgba(255,255,255,0.16)",
		tagText: "#ffffff",
		dotFilled: "#ffffff",
		dotEmpty: "rgba(255,255,255,0.28)",
		langBorder: "rgba(255,255,255,0.2)",
	});
	const tintSide = makeColumn({
		side: true,
		text: "#27364a",
		muted: "#7b8794",
		title: accent,
		rule: accent,
		heading: "#1f2933",
		tagBg: tint(accent, 0.16),
		tagText: accent,
		dotFilled: accent,
		dotEmpty: "#dde3ea",
		langBorder: "#eceff3",
	});

	const nameBlock = (color: string, size = 24) => (
		<>
			<Text style={[shared.name, { color, fontSize: size }]}>{cv.name}</Text>
			<Text style={[shared.role, { color: color === "#ffffff" ? "rgba(255,255,255,0.85)" : "#52606d" }]}>
				{cv.title}
			</Text>
		</>
	);

	// Pinned photo + contacts for the solid-accent sidebar (shared by the left- and right-side variants).
	const accentSideHeader = () => (
		<>
			{cv.photo && (
				<View
					style={{
						width: 132,
						height: 132,
						borderRadius: 66,
						alignSelf: "center",
						marginBottom: 18,
						padding: 3,
						backgroundColor: "rgba(255,255,255,0.16)",
					}}
				>
					<Image src={cv.photo} style={{ width: "100%", height: "100%", borderRadius: 63, objectFit: "cover" }} />
				</View>
			)}
			<SectionTitle label="Coordonnées" col={accentSide} />
			{contactItems(cv).map((item) => (
				<View key={item.key} style={{ flexDirection: "row", alignItems: "flex-start", marginBottom: 5 }}>
					{cv.showIcons && <ContactIcon name={item.key} color={cv.iconColor || "#e6edf5"} />}
					<Text
						style={{
							fontSize: 9.5,
							lineHeight: 1,
							color: "rgba(255,255,255,0.88)",
							marginLeft: cv.showIcons ? 6 : 0,
							flex: 1,
						}}
					>
						{item.value}
					</Text>
				</View>
			))}
		</>
	);

	// Pinned photo + contacts for a LIGHT tinted sidebar (dark text) — shared by gengar + kakuna.
	const tintSideHeader = () => (
		<>
			{cv.photo && (
				<View
					style={{
						width: 130,
						height: 130,
						borderRadius: 65,
						alignSelf: "center",
						marginBottom: 16,
						padding: 3,
						backgroundColor: "#ffffff",
					}}
				>
					<Image src={cv.photo} style={{ width: "100%", height: "100%", borderRadius: 62, objectFit: "cover" }} />
				</View>
			)}
			<SectionTitle label="Coordonnées" col={tintSide} />
			{contactItems(cv).map((item) => (
				<View key={item.key} style={{ flexDirection: "row", alignItems: "flex-start", marginBottom: 5 }}>
					{cv.showIcons && <ContactIcon name={item.key} color={cv.iconColor || accent} />}
					<Text style={{ fontSize: 9.5, lineHeight: 1, color: "#3e4c59", marginLeft: cv.showIcons ? 6 : 0, flex: 1 }}>
						{item.value}
					</Text>
				</View>
			))}
		</>
	);

	switch (cv.template) {
		case "glalie": {
			// Single column with a centred header (photo + name + title + contacts all centred).
			const glalieMain = makeColumn({
				side: false,
				text: "#27364a",
				muted: "#8894a3",
				title: "#1f2933",
				rule: accent,
				heading: "#1f2933",
				tagBg: "#f1f3f6",
				tagText: "#3e4c59",
				dotFilled: accent,
				dotEmpty: "#e2e6ec",
				langBorder: "#f0f2f5",
			});
			return {
				structure: "single",
				page: { paddingHorizontal: 52, paddingVertical: 44, fontFamily: "Helvetica", color: "#1f2933", fontSize: 10 },
				main: glalieMain,
				side: glalieMain,
				Header: () => (
					<View
						style={{
							alignItems: "center",
							borderBottomWidth: 1,
							borderBottomColor: "#e4e7eb",
							paddingBottom: 14,
							marginBottom: 6,
						}}
					>
						{cv.photo && (
							<Image
								src={cv.photo}
								style={{ width: 88, height: 88, borderRadius: 44, objectFit: "cover", marginBottom: 10 }}
							/>
						)}
						<Text style={[shared.name, { color: "#101820", fontSize: 27, textAlign: "center" }]}>{cv.name}</Text>
						<Text style={[shared.role, { color: accent, fontSize: 13, textAlign: "center" }]}>{cv.title}</Text>
						<ContactList cv={cv} color="#667085" iconColor={cv.iconColor || "#98a2b3"} center />
					</View>
				),
			};
		}

		case "scizor":
			// Full-width solid-accent banner across the top, single column below.
			return {
				structure: "topband",
				page: { fontFamily: "Helvetica", color: "#1f2933", fontSize: 10, paddingTop: 30, paddingBottom: 30 },
				body: { paddingHorizontal: 40, paddingTop: 18 },
				main: lightMain,
				side: lightMain,
				Header: () => null,
				Banner: () => (
					<View
						style={{
							backgroundColor: accent,
							paddingHorizontal: 40,
							paddingVertical: 24,
							flexDirection: "row",
							alignItems: "center",
							gap: 18,
						}}
					>
						{cv.photo && (
							<Image
								src={cv.photo}
								style={{
									width: 78,
									height: 78,
									borderRadius: 39,
									objectFit: "cover",
									borderWidth: 2,
									borderColor: "rgba(255,255,255,0.4)",
								}}
							/>
						)}
						<View style={{ flex: 1 }}>
							<Text style={[shared.name, { color: "#ffffff", fontSize: 25 }]}>{cv.name}</Text>
							<Text style={[shared.role, { color: "rgba(255,255,255,0.85)" }]}>{cv.title}</Text>
							<ContactList cv={cv} color="rgba(255,255,255,0.92)" iconColor="#ffffff" />
						</View>
					</View>
				),
			};

		case "lapras":
			// Soft tinted top banner + accent rule, single column below.
			return {
				structure: "topband",
				page: { fontFamily: "Helvetica", color: "#1f2933", fontSize: 10, paddingTop: 30, paddingBottom: 30 },
				body: { paddingHorizontal: 42, paddingTop: 16 },
				main: lightMain,
				side: lightMain,
				Header: () => null,
				Banner: () => (
					<View
						style={{
							backgroundColor: tint(accent, 0.12),
							paddingHorizontal: 42,
							paddingVertical: 22,
							flexDirection: "row",
							alignItems: "center",
							gap: 18,
							borderBottomWidth: 2,
							borderBottomColor: accent,
						}}
					>
						{cv.photo && (
							<Image src={cv.photo} style={{ width: 76, height: 76, borderRadius: 38, objectFit: "cover" }} />
						)}
						<View style={{ flex: 1 }}>
							{nameBlock(accent, 25)}
							<ContactList cv={cv} color="#667085" iconColor={cv.iconColor || accent} />
						</View>
					</View>
				),
			};

		case "meowth":
			// Solid-accent sidebar on the RIGHT.
			return {
				structure: "sidebar",
				page: {
					flexDirection: "row",
					fontFamily: "Helvetica",
					color: "#1f2933",
					fontSize: 10,
					paddingTop: 30,
					paddingBottom: 30,
				},
				main: lightMain,
				side: accentSide,
				sideBg: accent,
				sideOnLeft: false,
				Header: () => <View style={{ marginBottom: 2 }}>{nameBlock(accent)}</View>,
				SideHeader: accentSideHeader,
			};

		case "onyx": {
			// Single column, section titles underlined by a full-width hairline (traditional résumé look).
			const onyxMain = makeColumn({
				side: false,
				text: "#27364a",
				muted: "#7b8794",
				title: accent,
				rule: accent,
				ruleWide: true,
				heading: "#1f2933",
				tagBg: "#eef2f6",
				tagText: "#3e4c59",
				dotFilled: accent,
				dotEmpty: "#dde3ea",
				langBorder: "#f0f2f5",
			});
			return {
				structure: "single",
				page: { paddingHorizontal: 44, paddingVertical: 36, fontFamily: "Helvetica", color: "#1f2933", fontSize: 10 },
				main: onyxMain,
				side: onyxMain,
				Header: () => (
					<View
						style={{
							flexDirection: "row",
							alignItems: "center",
							gap: 16,
							borderBottomWidth: 2,
							borderBottomColor: accent,
							paddingBottom: 11,
							marginBottom: 3,
						}}
					>
						{cv.photo && (
							<Image src={cv.photo} style={{ width: 84, height: 84, borderRadius: 42, objectFit: "cover" }} />
						)}
						<View style={{ flex: 1 }}>
							{nameBlock(accent, 25)}
							<ContactList cv={cv} color="#667085" iconColor={cv.iconColor || accent} />
						</View>
					</View>
				),
			};
		}

		case "gengar":
			return {
				structure: "sidebar",
				page: {
					flexDirection: "row",
					fontFamily: "Helvetica",
					color: "#1f2933",
					fontSize: 10,
					paddingTop: 30,
					paddingBottom: 30,
				},
				main: lightMain,
				side: tintSide,
				sideBg: tint(accent, 0.12),
				Header: () => <View style={{ marginBottom: 2 }}>{nameBlock(accent)}</View>,
				SideHeader: tintSideHeader,
			};

		case "kakuna":
			// Light tinted sidebar on the RIGHT.
			return {
				structure: "sidebar",
				page: {
					flexDirection: "row",
					fontFamily: "Helvetica",
					color: "#1f2933",
					fontSize: 10,
					paddingTop: 30,
					paddingBottom: 30,
				},
				main: lightMain,
				side: tintSide,
				sideBg: tint(accent, 0.12),
				sideOnLeft: false,
				Header: () => <View style={{ marginBottom: 2 }}>{nameBlock(accent)}</View>,
				SideHeader: tintSideHeader,
			};

		case "bronzor":
			// Two columns under a soft tinted banner (accent rule at its base).
			return {
				structure: "banded",
				page: { fontFamily: "Helvetica", color: "#1f2933", fontSize: 10, paddingTop: 30, paddingBottom: 30 },
				main: lightMain,
				side: tintSide,
				sideOnLeft: true,
				Header: () => null,
				Banner: () => (
					<View
						style={{
							backgroundColor: tint(accent, 0.12),
							paddingHorizontal: 34,
							paddingVertical: 20,
							flexDirection: "row",
							alignItems: "center",
							gap: 16,
							borderBottomWidth: 2,
							borderBottomColor: accent,
						}}
					>
						{cv.photo && (
							<Image src={cv.photo} style={{ width: 70, height: 70, borderRadius: 35, objectFit: "cover" }} />
						)}
						<View>
							{nameBlock(accent)}
							<ContactList cv={cv} color="#667085" iconColor={cv.iconColor || accent} />
						</View>
					</View>
				),
			};

		case "ditto":
			return {
				structure: "banded",
				page: { fontFamily: "Helvetica", color: "#1f2933", fontSize: 10, paddingTop: 30, paddingBottom: 30 },
				main: lightMain,
				side: tintSide,
				sideOnLeft: false,
				Header: () => null,
				Banner: () => (
					<View style={{ backgroundColor: accent, paddingHorizontal: 34, paddingVertical: 22, alignItems: "center" }}>
						{cv.photo && (
							<Image
								src={cv.photo}
								style={{
									width: 76,
									height: 76,
									borderRadius: 38,
									objectFit: "cover",
									borderWidth: 2,
									borderColor: "rgba(255,255,255,0.4)",
									marginBottom: 9,
								}}
							/>
						)}
						<Text style={[shared.name, { color: "#ffffff", fontSize: 24, textAlign: "center" }]}>{cv.name}</Text>
						<Text style={[shared.role, { color: "rgba(255,255,255,0.85)", textAlign: "center" }]}>{cv.title}</Text>
						<ContactList cv={cv} color="rgba(255,255,255,0.92)" iconColor="#ffffff" center />
					</View>
				),
			};

		case "sidebar":
			return {
				structure: "sidebar",
				page: {
					flexDirection: "row",
					fontFamily: "Helvetica",
					color: "#1f2933",
					fontSize: 10,
					paddingTop: 30,
					paddingBottom: 30,
				},
				main: lightMain,
				side: accentSide,
				sideBg: accent,
				Header: () => <View style={{ marginBottom: 2 }}>{nameBlock(accent)}</View>,
				SideHeader: accentSideHeader,
			};

		case "pikachu":
			return {
				structure: "banded",
				page: { fontFamily: "Helvetica", color: "#1f2933", fontSize: 10, paddingTop: 30, paddingBottom: 30 },
				main: lightMain,
				side: tintSide,
				sideOnLeft: true,
				Header: () => null,
				Banner: () => (
					<View
						style={{
							backgroundColor: accent,
							paddingHorizontal: 34,
							paddingVertical: 22,
							flexDirection: "row",
							alignItems: "center",
							gap: 16,
						}}
					>
						{cv.photo && (
							<Image
								src={cv.photo}
								style={{
									width: 74,
									height: 74,
									borderRadius: 37,
									objectFit: "cover",
									borderWidth: 2,
									borderColor: "rgba(255,255,255,0.4)",
								}}
							/>
						)}
						<View>
							{nameBlock("#ffffff")}
							<ContactList cv={cv} color="rgba(255,255,255,0.92)" iconColor="#ffffff" />
						</View>
					</View>
				),
			};

		case "leafish":
			return {
				structure: "banded",
				page: { fontFamily: "Helvetica", color: "#1f2933", fontSize: 10, paddingTop: 30, paddingBottom: 30 },
				main: lightMain,
				side: tintSide,
				sideOnLeft: false,
				Header: () => null,
				Banner: () => (
					<View>
						<View
							style={{
								backgroundColor: tint(accent, 0.12),
								paddingHorizontal: 34,
								paddingVertical: 20,
								flexDirection: "row",
								alignItems: "center",
								gap: 16,
							}}
						>
							{cv.photo && (
								<Image src={cv.photo} style={{ width: 70, height: 70, borderRadius: 35, objectFit: "cover" }} />
							)}
							<View>{nameBlock(accent)}</View>
						</View>
						<View style={{ backgroundColor: tint(accent, 0.22), paddingHorizontal: 34, paddingVertical: 9 }}>
							<ContactList cv={cv} color="#334155" iconColor={cv.iconColor || accent} />
						</View>
					</View>
				),
			};

		case "rhyhorn":
			return {
				structure: "single",
				page: { paddingHorizontal: 42, paddingVertical: 34, fontFamily: "Helvetica", color: "#1f2933", fontSize: 10 },
				main: lightMain,
				side: lightMain,
				Header: () => (
					<View
						style={{
							flexDirection: "row",
							alignItems: "center",
							justifyContent: "space-between",
							borderBottomWidth: 1.5,
							borderBottomColor: accent,
							paddingBottom: 12,
							marginBottom: 4,
						}}
					>
						<View style={{ flex: 1 }}>
							{nameBlock(accent, 25)}
							<ContactList
								cv={cv}
								color="#52606d"
								iconColor={cv.iconColor || accent}
								dividerColor={tint(accent, 0.55)}
							/>
						</View>
						{cv.photo && (
							<Image
								src={cv.photo}
								style={{ width: 78, height: 78, borderRadius: 39, objectFit: "cover", marginLeft: 16 }}
							/>
						)}
					</View>
				),
			};

		case "azurill": {
			// Single column; each experience/education entry gets a vertical accent bar (timeline look).
			const azurillMain = makeColumn({
				side: false,
				text: "#27364a",
				muted: "#7b8794",
				title: accent,
				rule: accent,
				heading: "#1f2933",
				tagBg: "#eef2f6",
				tagText: "#3e4c59",
				dotFilled: accent,
				dotEmpty: "#dde3ea",
				langBorder: "#f0f2f5",
				entryBar: accent,
			});
			return {
				structure: "single",
				page: { paddingHorizontal: 44, paddingVertical: 34, fontFamily: "Helvetica", color: "#1f2933", fontSize: 10 },
				main: azurillMain,
				side: azurillMain,
				Header: () => (
					<View
						style={{
							flexDirection: "row",
							alignItems: "center",
							gap: 16,
							borderBottomWidth: 1,
							borderBottomColor: "#e4e7eb",
							paddingBottom: 12,
							marginBottom: 2,
						}}
					>
						{cv.photo && (
							<Image src={cv.photo} style={{ width: 86, height: 86, borderRadius: 43, objectFit: "cover" }} />
						)}
						<View style={{ flex: 1 }}>
							{nameBlock(accent, 25)}
							<ContactList cv={cv} color="#667085" iconColor={cv.iconColor || accent} />
						</View>
					</View>
				),
			};
		}

		case "minimal":
			return {
				structure: "single",
				page: { paddingHorizontal: 54, paddingVertical: 48, fontFamily: "Helvetica", color: "#1f2933", fontSize: 10 },
				main: makeColumn({
					side: false,
					text: "#27364a",
					muted: "#8894a3",
					title: "#1f2933",
					heading: "#1f2933",
					tagBg: "#f1f3f6",
					tagText: "#3e4c59",
					dotFilled: accent,
					dotEmpty: "#e2e6ec",
					langBorder: "#f0f2f5",
				}),
				side: lightMain,
				Header: () => (
					<View style={{ marginBottom: 6 }}>
						<Text style={[shared.name, { color: "#101820", fontSize: 30 }]}>{cv.name}</Text>
						<Text style={[shared.role, { color: accent, fontSize: 13 }]}>{cv.title}</Text>
						<ContactList cv={cv} color="#667085" iconColor={cv.iconColor || "#98a2b3"} />
					</View>
				),
			};

		default: // classic
			return {
				structure: "single",
				page: { paddingHorizontal: 40, paddingVertical: 32, fontFamily: "Helvetica", color: "#1f2933", fontSize: 10 },
				main: lightMain,
				side: lightMain,
				Header: () => (
					<View
						style={{
							flexDirection: "row",
							alignItems: "center",
							gap: 18,
							borderBottomWidth: 1,
							borderBottomColor: "#e4e7eb",
							paddingBottom: 12,
							marginBottom: 3,
						}}
					>
						{cv.photo && (
							<Image src={cv.photo} style={{ width: 92, height: 92, borderRadius: 46, objectFit: "cover" }} />
						)}
						<View style={{ flex: 1 }}>
							{nameBlock(accent, 26)}
							<ContactList cv={cv} color="#7b8794" iconColor={cv.iconColor || "#7b8794"} />
						</View>
					</View>
				),
			};
	}
};

// ---------------------------------------------------------------------------
// Page renderers (one per structure)
// ---------------------------------------------------------------------------

const SinglePage = ({ cv, t, page, first }: { cv: CV; t: Template; page: PageLayout; first: boolean }) => (
	<Page size="A4" style={t.page}>
		{first && t.Header()}
		<Sections ids={[...page.main, ...page.sidebar]} cv={cv} col={t.main} firstOnPage={first} />
	</Page>
);

const SidebarPage = ({
	cv,
	t,
	page,
	first,
	sideWidth,
}: {
	cv: CV;
	t: Template;
	page: PageLayout;
	first: boolean;
	sideWidth: number;
}) => {
	const onLeft = t.sideOnLeft !== false; // default: sidebar on the left
	// Vertical padding lives on the Page so EVERY page (including flow-continuation pages) keeps a
	// top/bottom margin; the columns only pad horizontally.
	const side = (
		<View style={{ width: sideWidth, paddingHorizontal: 20 }}>
			{first && t.SideHeader?.()}
			<Sections ids={page.sidebar} cv={cv} col={t.side} allowNewPage={false} />
		</View>
	);
	const main = (
		<View style={{ flex: 1, paddingHorizontal: 28 }}>
			{first && t.Header()}
			<Sections ids={page.main} cv={cv} col={t.main} firstOnPage={first} />
		</View>
	);
	return (
		<Page size="A4" style={t.page}>
			<View
				fixed
				style={
					onLeft
						? { position: "absolute", top: 0, left: 0, width: sideWidth, height: A4_HEIGHT, backgroundColor: t.sideBg }
						: { position: "absolute", top: 0, right: 0, width: sideWidth, height: A4_HEIGHT, backgroundColor: t.sideBg }
				}
			>
				<Svg width={sideWidth} height={A4_HEIGHT} style={{ position: "absolute", top: 0, left: 0 }}>
					{patternDots(sideWidth)}
				</Svg>
			</View>
			{onLeft ? (
				<>
					{side}
					{main}
				</>
			) : (
				<>
					{main}
					{side}
				</>
			)}
		</Page>
	);
};

const TopBandPage = ({ cv, t, page, first }: { cv: CV; t: Template; page: PageLayout; first: boolean }) => (
	// Vertical padding on the Page gives every page (incl. flow-continuation pages) a top/bottom margin;
	// the banner escapes the top padding with a negative margin so it stays full-bleed on page 1.
	<Page size="A4" style={t.page}>
		{first && <View style={{ marginTop: -30 }}>{t.Banner?.()}</View>}
		<View style={t.body}>
			<Sections ids={[...page.main, ...page.sidebar]} cv={cv} col={t.main} firstOnPage={first} />
		</View>
	</Page>
);

const BandedPage = ({
	cv,
	t,
	page,
	first,
	sideWidth,
}: {
	cv: CV;
	t: Template;
	page: PageLayout;
	first: boolean;
	sideWidth: number;
}) => {
	// A banded template only reserves the narrow column when the user actually placed sections in it —
	// otherwise the main content spans the full width instead of leaving a blank gap.
	const hasSide = page.sidebar.length > 0;
	const side = hasSide ? (
		<View style={{ width: sideWidth }}>
			<Sections ids={page.sidebar} cv={cv} col={t.side} allowNewPage={false} />
		</View>
	) : null;
	const main = (
		<View style={{ flex: 1 }}>
			<Sections ids={page.main} cv={cv} col={t.main} firstOnPage={first} />
		</View>
	);
	return (
		<Page size="A4" style={t.page}>
			{first && <View style={{ marginTop: -30 }}>{t.Banner?.()}</View>}
			<View
				style={{
					flexDirection: "row",
					gap: hasSide ? 22 : 0,
					paddingHorizontal: 34,
					paddingTop: 18,
				}}
			>
				{t.sideOnLeft ? (
					<>
						{side}
						{main}
					</>
				) : (
					<>
						{main}
						{side}
					</>
				)}
			</View>
		</Page>
	);
};

export function CVPdf({ cv }: { cv: CV }) {
	const t = resolveTemplate(cv);
	const layout = normalizeLayout(cv.layout);
	const sideWidth = Math.round((A4_WIDTH * layout.sidebarWidth) / 100);
	return (
		<Document title={cv.name || "CV"}>
			{layout.pages.map((page, index) => {
				const first = index === 0;
				if (t.structure === "sidebar")
					return <SidebarPage key={index} cv={cv} t={t} page={page} first={first} sideWidth={sideWidth} />;
				if (t.structure === "banded")
					return <BandedPage key={index} cv={cv} t={t} page={page} first={first} sideWidth={sideWidth} />;
				if (t.structure === "topband") return <TopBandPage key={index} cv={cv} t={t} page={page} first={first} />;
				return <SinglePage key={index} cv={cv} t={t} page={page} first={first} />;
			})}
		</Document>
	);
}
