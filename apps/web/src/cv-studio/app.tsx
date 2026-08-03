import type { DragEndEvent, DragOverEvent, DragStartEvent, UniqueIdentifier } from "@dnd-kit/core";
import type { PreviewPageSize } from "../features/resume/preview/preview.shared.utils";
import type { CV, Education, Experience, PageLayout, SectionBreakMode, SectionId, TemplateKey } from "./cv-data";
import {
	closestCorners,
	DndContext,
	DragOverlay,
	PointerSensor,
	useDroppable,
	useSensor,
	useSensors,
} from "@dnd-kit/core";
import { arrayMove, SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { PDFDownloadLink, pdf } from "@react-pdf/renderer";
import { useEffect, useMemo, useRef, useState } from "react";
import { PdfCanvasDocument, PdfCanvasPage } from "../features/resume/preview/pdf-canvas";
import {
	hydrateCv,
	isAtsFriendly,
	normalizeLayout,
	PALETTE,
	SECTION_BREAK_LABELS,
	SECTION_LABELS,
	SIDEBAR_STRUCTURE_TEMPLATES,
	sample,
	storageKey,
	TEMPLATES,
	TWO_COLUMN_TEMPLATES,
} from "./cv-data";
import { CVPdf } from "./pdf";
import "./styles.css";

function EgyptFlag() {
	return (
		<svg className="cv-flag" viewBox="0 0 30 20" preserveAspectRatio="none" role="img" aria-label="Drapeau égyptien">
			<rect width="30" height="6.667" fill="#ce1126" />
			<rect y="6.667" width="30" height="6.666" fill="#fff" />
			<rect y="13.333" width="30" height="6.667" fill="#111" />
			<circle cx="15" cy="10" r="2.4" fill="#c8a02a" />
		</svg>
	);
}

function Field({
	label,
	value,
	onChange,
	area = false,
}: {
	label: string;
	value: string;
	onChange: (value: string) => void;
	area?: boolean;
}) {
	return (
		// biome-ignore lint/a11y/noLabelWithoutControl: the input/textarea control is nested inside this label
		<label className="cv-field">
			<span>{label}</span>
			{area ? (
				<textarea value={value} onChange={(event) => onChange(event.target.value)} />
			) : (
				<input value={value} onChange={(event) => onChange(event.target.value)} />
			)}
		</label>
	);
}

function ExperienceEditor({
	item,
	onChange,
	onRemove,
}: {
	item: Experience;
	onChange: (item: Experience) => void;
	onRemove: () => void;
}) {
	return (
		<div className="cv-mini-card">
			<div className="cv-two">
				<Field label="Poste" value={item.role} onChange={(role) => onChange({ ...item, role })} />
				<Field label="Entreprise" value={item.company} onChange={(company) => onChange({ ...item, company })} />
			</div>
			<div className="cv-two">
				<Field label="Date" value={item.date} onChange={(date) => onChange({ ...item, date })} />
				<Field label="Lieu" value={item.place} onChange={(place) => onChange({ ...item, place })} />
			</div>
			<Field
				label="Description"
				value={item.description}
				onChange={(description) => onChange({ ...item, description })}
				area
			/>
			<button type="button" className="cv-link-button" onClick={onRemove}>
				Supprimer
			</button>
		</div>
	);
}

function EducationEditor({
	item,
	onChange,
	onRemove,
}: {
	item: Education;
	onChange: (item: Education) => void;
	onRemove: () => void;
}) {
	return (
		<div className="cv-mini-card">
			<Field label="Diplôme" value={item.degree} onChange={(degree) => onChange({ ...item, degree })} />
			<div className="cv-two">
				<Field label="École" value={item.school} onChange={(school) => onChange({ ...item, school })} />
				<Field label="Date" value={item.date} onChange={(date) => onChange({ ...item, date })} />
			</div>
			<Field label="Lieu" value={item.place} onChange={(place) => onChange({ ...item, place })} />
			<button type="button" className="cv-link-button" onClick={onRemove}>
				Supprimer
			</button>
		</div>
	);
}

// ---------------------------------------------------------------------------
// Drag-and-drop page/column layout editor (assign sections to pages & columns)
// ---------------------------------------------------------------------------

type Containers = Record<string, SectionId[]>;
const columnKey = (page: number, col: "main" | "sidebar") => `${page}|${col}`;
const isColumnKey = (id: UniqueIdentifier): id is string => typeof id === "string" && id.includes("|");
// dnd-kit ids are string | number; ours are always section-id strings.
const asSectionId = (id: UniqueIdentifier): SectionId => id as string as SectionId;
const toContainers = (pages: PageLayout[]): Containers => {
	const map: Containers = {};
	pages.forEach((page, index) => {
		map[columnKey(index, "main")] = [...page.main];
		map[columnKey(index, "sidebar")] = [...page.sidebar];
	});
	return map;
};
const fromContainers = (containers: Containers, pageCount: number): PageLayout[] =>
	Array.from({ length: pageCount }, (_, index) => ({
		main: containers[columnKey(index, "main")] ?? [],
		sidebar: containers[columnKey(index, "sidebar")] ?? [],
	}));

function SectionChip({
	id,
	mode,
	onModeChange,
}: {
	id: SectionId;
	mode: SectionBreakMode;
	onModeChange: (mode: SectionBreakMode) => void;
}) {
	const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
	return (
		<div
			ref={setNodeRef}
			className="cv-layout-chip"
			style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 }}
		>
			<div className="cv-layout-chip-head">
				<span className="cv-layout-grip" {...attributes} {...listeners} title="Déplacer la section">
					⠿
				</span>
				<span className="cv-layout-chip-label">{SECTION_LABELS[id]}</span>
			</div>
			<select
				className="cv-layout-mode"
				value={mode}
				onChange={(event) => onModeChange(event.target.value as SectionBreakMode)}
				title="Comportement quand la section arrive en fin de page"
			>
				{SECTION_BREAK_LABELS.map((option) => (
					<option key={option.value} value={option.value}>
						{option.label}
					</option>
				))}
			</select>
		</div>
	);
}

function LayoutColumn({
	id,
	label,
	items,
	cv,
	onSetMode,
}: {
	id: string;
	label?: string;
	items: SectionId[];
	cv: CV;
	onSetMode: (id: SectionId, mode: SectionBreakMode) => void;
}) {
	const { setNodeRef, isOver } = useDroppable({ id });
	return (
		<div className="cv-layout-colwrap">
			{label && <span className="cv-layout-collabel">{label}</span>}
			<SortableContext id={id} items={items} strategy={verticalListSortingStrategy}>
				<div ref={setNodeRef} className={isOver ? "cv-layout-col over" : "cv-layout-col"}>
					{items.length === 0 ? (
						<p className="cv-layout-empty">Déposez une section ici</p>
					) : (
						items.map((sid) => (
							<SectionChip
								key={sid}
								id={sid}
								mode={cv.sectionOptions[sid]?.mode ?? "flow"}
								onModeChange={(mode) => onSetMode(sid, mode)}
							/>
						))
					)}
				</div>
			</SortableContext>
		</div>
	);
}

function LayoutEditor({ cv, setCv }: { cv: CV; setCv: (cv: CV) => void }) {
	const twoCol = TWO_COLUMN_TEMPLATES.includes(cv.template);
	// The width slider only matters when a side column is actually shown: always for the accent-sidebar
	// templates, and for banded templates only once the user has placed sections in the side column.
	const hasSidebarContent = cv.layout.pages.some((page) => page.sidebar.length > 0);
	const showWidthSlider = SIDEBAR_STRUCTURE_TEMPLATES.includes(cv.template) || (twoCol && hasSidebarContent);
	const pageCount = cv.layout.pages.length;
	const [containers, setContainers] = useState<Containers>(() => toContainers(cv.layout.pages));
	const [activeId, setActiveId] = useState<SectionId | null>(null);
	const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
	// containersRef mirrors state synchronously so drag handlers never read a batched-stale value.
	const containersRef = useRef(containers);
	const apply = (next: Containers) => {
		containersRef.current = next;
		setContainers(next);
	};

	// Re-sync when the layout changes outside a drag (add/remove page, template fold, reset, import).
	useEffect(() => {
		const next = toContainers(cv.layout.pages);
		containersRef.current = next;
		setContainers(next);
	}, [cv.layout]);

	const findColumn = (id: UniqueIdentifier): string | undefined =>
		isColumnKey(id)
			? id
			: Object.keys(containersRef.current).find((key) => containersRef.current[key].includes(asSectionId(id)));

	const onDragStart = ({ active }: DragStartEvent) => setActiveId(asSectionId(active.id));

	const onDragOver = ({ active, over }: DragOverEvent) => {
		if (!over) return;
		const from = findColumn(active.id);
		const to = findColumn(over.id);
		if (!from || !to || from === to) return;
		const prev = containersRef.current;
		const fromItems = prev[from];
		const toItems = prev[to];
		const overIndex = isColumnKey(over.id) ? toItems.length : toItems.indexOf(asSectionId(over.id));
		const insertAt = overIndex >= 0 ? overIndex : toItems.length;
		apply({
			...prev,
			[from]: fromItems.filter((sid) => sid !== active.id),
			[to]: [...toItems.slice(0, insertAt), asSectionId(active.id), ...toItems.slice(insertAt)],
		});
	};

	const onDragEnd = ({ active, over }: DragEndEvent) => {
		setActiveId(null);
		const prev = containersRef.current;
		let next = prev;
		if (over) {
			const from = findColumn(active.id);
			const to = findColumn(over.id);
			if (from && to && from === to && !isColumnKey(over.id)) {
				const items = prev[from];
				const oldIndex = items.indexOf(asSectionId(active.id));
				const newIndex = items.indexOf(asSectionId(over.id));
				if (oldIndex !== newIndex && newIndex >= 0) next = { ...prev, [from]: arrayMove(items, oldIndex, newIndex) };
			}
		}
		apply(next);
		setCv({ ...cv, layout: normalizeLayout({ ...cv.layout, pages: fromContainers(next, pageCount) }) });
	};

	const setMode = (id: SectionId, mode: SectionBreakMode) =>
		setCv({ ...cv, sectionOptions: { ...cv.sectionOptions, [id]: { mode } } });

	const addPage = () =>
		setCv({ ...cv, layout: { ...cv.layout, pages: [...cv.layout.pages, { main: [], sidebar: [] }] } });

	const removePage = (index: number) => {
		const pages = cv.layout.pages.filter((_, i) => i !== index);
		// normalizeLayout re-homes the removed page's sections onto the last remaining page's main column.
		setCv({
			...cv,
			layout: normalizeLayout({ ...cv.layout, pages: pages.length ? pages : [{ main: [], sidebar: [] }] }),
		});
	};

	return (
		<section className="cv-panel">
			<h2>Mise en page</h2>
			<p className="cv-hint">
				Glisse les sections entre les colonnes et les pages. Le menu par section choisit son comportement en fin de page
				: <strong>Couper</strong> (peut passer sur 2 pages), <strong>Grouper</strong> (reste entière),{" "}
				<strong>Nouvelle page</strong>.
			</p>
			<DndContext
				sensors={sensors}
				collisionDetection={closestCorners}
				onDragStart={onDragStart}
				onDragOver={onDragOver}
				onDragEnd={onDragEnd}
			>
				{cv.layout.pages.map((_, index) => (
					<div className="cv-layout-page" key={index}>
						<div className="cv-layout-pagehead">
							<span>Page {index + 1}</span>
							{pageCount > 1 && (
								<button type="button" className="cv-link-button" onClick={() => removePage(index)}>
									Supprimer
								</button>
							)}
						</div>
						<div className={twoCol ? "cv-layout-cols two" : "cv-layout-cols"}>
							<LayoutColumn
								id={columnKey(index, "main")}
								label={twoCol ? "Principale" : undefined}
								items={containers[columnKey(index, "main")] ?? []}
								cv={cv}
								onSetMode={setMode}
							/>
							{twoCol && (
								<LayoutColumn
									id={columnKey(index, "sidebar")}
									label="Latérale"
									items={containers[columnKey(index, "sidebar")] ?? []}
									cv={cv}
									onSetMode={setMode}
								/>
							)}
						</div>
					</div>
				))}
				<DragOverlay>
					{activeId ? (
						<div className="cv-layout-chip dragging">
							<span className="cv-layout-grip">⠿</span>
							<span className="cv-layout-chip-label">{SECTION_LABELS[activeId]}</span>
						</div>
					) : null}
				</DragOverlay>
			</DndContext>
			<button type="button" className="cv-add-button" onClick={addPage}>
				+ Ajouter une page
			</button>
			{showWidthSlider && (
				<label className="cv-field cv-layout-width">
					<span>Largeur colonne latérale : {cv.layout.sidebarWidth}%</span>
					<input
						type="range"
						min={20}
						max={45}
						value={cv.layout.sidebarWidth}
						onChange={(event) => setCv({ ...cv, layout: { ...cv.layout, sidebarWidth: Number(event.target.value) } })}
					/>
				</label>
			)}
		</section>
	);
}

function Editor({ cv, setCv }: { cv: CV; setCv: (cv: CV) => void }) {
	const set = <K extends keyof CV>(key: K, value: CV[K]) => setCv({ ...cv, [key]: value });
	// Switching to a single-column template folds any sidebar sections back into the main column
	// so nothing disappears from the page.
	const setTemplate = (template: TemplateKey) => {
		const layout = TWO_COLUMN_TEMPLATES.includes(template)
			? cv.layout
			: normalizeLayout({
					...cv.layout,
					pages: cv.layout.pages.map((page) => ({ main: [...page.main, ...page.sidebar], sidebar: [] })),
				});
		setCv({ ...cv, template, layout });
	};
	// ATS readability of the CURRENT template + layout: single/topband is always clean; a permanent
	// accent sidebar is always two-column; a banded template is clean only while its side column is empty.
	const atsHasSide = cv.layout.pages.some((page) => page.sidebar.length > 0);
	const atsState: "ok" | "warn" | "conditional" = !TWO_COLUMN_TEMPLATES.includes(cv.template)
		? "ok"
		: SIDEBAR_STRUCTURE_TEMPLATES.includes(cv.template) || atsHasSide
			? "warn"
			: "conditional";
	const onPhoto = (file?: File) => {
		if (!file) return;
		const reader = new FileReader();
		reader.onload = () => set("photo", String(reader.result));
		reader.readAsDataURL(file);
	};

	return (
		<aside className="cv-editor">
			<div className="cv-logo">
				<div className="cv-logo-mark">
					<EgyptFlag />
				</div>
				<div>
					<strong>Nourhaine Studio</strong>
					<small>éditeur local</small>
				</div>
			</div>
			<section className="cv-panel">
				<h2>Design</h2>
				<label className="cv-field">
					<span>Modèle</span>
					<select value={cv.template} onChange={(event) => setTemplate(event.target.value as TemplateKey)}>
						{TEMPLATES.map((template) => (
							<option key={template.key} value={template.key}>
								{template.label}
								{isAtsFriendly(template.key) ? "  ✓ ATS" : ""}
							</option>
						))}
					</select>
				</label>
				<p className={atsState === "warn" ? "cv-hint cv-ats-warn" : "cv-hint cv-ats-ok"}>
					{atsState === "ok"
						? "✓ Modèle une colonne : bien lu par les logiciels de recrutement (ATS)."
						: atsState === "conditional"
							? "✓ Actuellement en une colonne (colonne latérale vide) → OK pour les ATS. Déplacer des sections dans la colonne latérale le ferait passer à deux colonnes."
							: "⚠ Deux colonnes : plus joli, mais les ATS peuvent mal lire l'ordre. Pour une candidature via un site d'emploi, préfère un modèle « ✓ ATS »."}
				</p>
				<label className="cv-field">
					<span>Couleur principale</span>
					<input type="color" value={cv.accent} onChange={(event) => set("accent", event.target.value)} />
				</label>
				<div className="cv-palette">
					{PALETTE.map((color) => (
						<button
							key={color}
							type="button"
							className={cv.accent === color ? "cv-swatch on" : "cv-swatch"}
							style={{ background: color }}
							onClick={() => set("accent", color)}
							aria-label={`Couleur ${color}`}
						/>
					))}
				</div>
				<label className="cv-check">
					<input type="checkbox" checked={cv.showIcons} onChange={(event) => set("showIcons", event.target.checked)} />
					<span>Icônes de contact (décoche pour une version simple)</span>
				</label>
				{cv.showIcons && (
					<label className="cv-field cv-icon-color">
						<span>Couleur des icônes</span>
						<input
							type="color"
							value={cv.iconColor || "#9fc3e8"}
							onChange={(event) => set("iconColor", event.target.value)}
						/>
					</label>
				)}
			</section>
			<LayoutEditor cv={cv} setCv={setCv} />
			<section className="cv-panel">
				<h2>Photo</h2>
				{cv.photo && <img className="cv-editor-photo" src={cv.photo} alt="Portrait" />}
				<label className="cv-file-button">
					Ajouter / changer la photo
					<input
						type="file"
						accept="image/png,image/jpeg,image/webp"
						onChange={(event) => onPhoto(event.target.files?.[0])}
					/>
				</label>
				{cv.photo && (
					<button type="button" className="cv-link-button" onClick={() => set("photo", "")}>
						Retirer la photo
					</button>
				)}
			</section>
			<section className="cv-panel">
				<h2>Identité</h2>
				<Field label="Nom" value={cv.name} onChange={(value) => set("name", value)} />
				<Field label="Titre" value={cv.title} onChange={(value) => set("title", value)} />
				<Field label="Email" value={cv.email} onChange={(value) => set("email", value)} />
				<Field label="Téléphone" value={cv.phone} onChange={(value) => set("phone", value)} />
				<Field label="Ville" value={cv.city} onChange={(value) => set("city", value)} />
				<Field label="Nationalité" value={cv.nationality} onChange={(value) => set("nationality", value)} />
				<Field label="Âge" value={cv.age} onChange={(value) => set("age", value)} />
				<Field label="Permis" value={cv.permis} onChange={(value) => set("permis", value)} />
				<Field label="Profil" value={cv.profile} onChange={(value) => set("profile", value)} area />
			</section>
			<section className="cv-panel">
				<h2>Expériences</h2>
				{cv.experiences.map((item, index) => (
					<ExperienceEditor
						key={index}
						item={item}
						onChange={(next) =>
							set(
								"experiences",
								cv.experiences.map((exp, i) => (i === index ? next : exp)),
							)
						}
						onRemove={() =>
							set(
								"experiences",
								cv.experiences.filter((_, i) => i !== index),
							)
						}
					/>
				))}
				<button
					type="button"
					className="cv-add-button"
					onClick={() =>
						set("experiences", [...cv.experiences, { role: "", company: "", date: "", place: "", description: "" }])
					}
				>
					+ Ajouter une expérience
				</button>
			</section>
			<section className="cv-panel">
				<h2>Formation</h2>
				{cv.education.map((item, index) => (
					<EducationEditor
						key={index}
						item={item}
						onChange={(next) =>
							set(
								"education",
								cv.education.map((edu, i) => (i === index ? next : edu)),
							)
						}
						onRemove={() =>
							set(
								"education",
								cv.education.filter((_, i) => i !== index),
							)
						}
					/>
				))}
				<button
					type="button"
					className="cv-add-button"
					onClick={() => set("education", [...cv.education, { degree: "", school: "", date: "", place: "" }])}
				>
					+ Ajouter une formation
				</button>
			</section>
			<section className="cv-panel">
				<h2>Compétences & langues</h2>
				<Field label="Compétences — une par ligne" value={cv.skills} onChange={(value) => set("skills", value)} area />
				<Field
					label="Langues — Langue | niveau | note 1-5 (points, optionnel)"
					value={cv.languages}
					onChange={(value) => set("languages", value)}
					area
				/>
				<Field label="Intérêts" value={cv.interests} onChange={(value) => set("interests", value)} area />
			</section>
		</aside>
	);
}

type PreviewLayer = {
	id: number;
	file: Blob;
	numPages: number;
	pageSizes: Record<number, PreviewPageSize>;
	renderedPages: number[];
	phase: "active" | "staged";
};

// Regenerate the PDF only once the user pauses typing.
const PREVIEW_DEBOUNCE_MS = 150;

/** Keep only the visible (active) layers, then stack the freshly built one on top. */
const stackPreviewLayer = (layers: PreviewLayer[], next: PreviewLayer): PreviewLayer[] => {
	const active = layers.filter((layer) => layer.phase === "active");
	return active.length === 0 ? [next] : [...active, next];
};

const setLayerPageCount = (layers: PreviewLayer[], id: number, numPages: number): PreviewLayer[] =>
	layers.map((layer) => (layer.id === id ? { ...layer, numPages } : layer));

const setLayerPageSize = (
	layers: PreviewLayer[],
	id: number,
	pageNumber: number,
	pageSize: PreviewPageSize,
): PreviewLayer[] =>
	layers.map((layer) =>
		layer.id === id ? { ...layer, pageSizes: { ...layer.pageSizes, [pageNumber]: pageSize } } : layer,
	);

/**
 * Mark a staged page as painted; once every page of a staged layer has rendered,
 * promote it to active and drop the previous active layer — so the swap only
 * happens when the new PDF is fully ready (no blank flash mid-edit).
 */
const markLayerPageRendered = (layers: PreviewLayer[], id: number, pageNumber: number): PreviewLayer[] => {
	let promote = false;
	const next = layers.map((layer) => {
		if (layer.id !== id || layer.renderedPages.includes(pageNumber)) return layer;
		const renderedPages = [...layer.renderedPages, pageNumber];
		if (layer.phase === "staged" && layer.numPages > 0 && renderedPages.length >= layer.numPages) {
			promote = true;
			return { ...layer, renderedPages, phase: "active" as const };
		}
		return { ...layer, renderedPages };
	});
	return promote ? next.filter((layer) => layer.id === id || layer.phase !== "active") : next;
};

/**
 * On-screen preview that renders the ACTUAL exported PDF (via @react-pdf/renderer)
 * to canvas with pdf.js — so what you see is exactly the downloaded document, page
 * breaks and all. Reuses the builder's battle-tested PdfCanvasDocument/PdfCanvasPage.
 */
function PdfPreview({ cv }: { cv: CV }) {
	const [layers, setLayers] = useState<PreviewLayer[]>([]);
	const idRef = useRef(0);

	useEffect(() => {
		let cancelled = false;
		const delay = idRef.current === 0 ? 0 : PREVIEW_DEBOUNCE_MS;
		const timer = window.setTimeout(async () => {
			try {
				const file = await pdf(<CVPdf cv={cv} />).toBlob();
				if (cancelled) return;
				setLayers((current) => {
					const hasActive = current.some((layer) => layer.phase === "active");
					const next: PreviewLayer = {
						id: idRef.current++,
						file,
						numPages: 0,
						pageSizes: {},
						renderedPages: [],
						phase: hasActive ? "staged" : "active",
					};
					return stackPreviewLayer(current, next);
				});
			} catch (error) {
				if (!cancelled) console.error("Aperçu PDF impossible à générer", error);
			}
		}, delay);
		return () => {
			cancelled = true;
			window.clearTimeout(timer);
		};
	}, [cv]);

	return (
		<div className="cv-pdf-preview">
			{layers.length === 0 && <p className="cv-pdf-status">Génération du PDF…</p>}
			<div className="cv-pdf-stack">
				{layers.map((layer) => (
					<div key={layer.id} className="cv-pdf-layer" data-phase={layer.phase} aria-hidden={layer.phase !== "active"}>
						<PdfCanvasDocument
							file={layer.file}
							onLoadSuccess={(document) =>
								setLayers((current) => setLayerPageCount(current, layer.id, document.numPages))
							}
						>
							{(document) => (
								<div className="cv-pdf-pages">
									{Array.from({ length: layer.numPages }, (_, index) => {
										const pageNumber = index + 1;
										return (
											<div className="cv-pdf-page" key={pageNumber}>
												<PdfCanvasPage
													document={document}
													pageNumber={pageNumber}
													pageScale={1}
													totalPages={layer.numPages}
													pageSize={layer.pageSizes[pageNumber]}
													className="cv-pdf-canvas"
													showPageNumbers={false}
													onLoadSuccess={(_, pageSize) =>
														setLayers((current) => setLayerPageSize(current, layer.id, pageNumber, pageSize))
													}
													onRenderSuccess={() => {
														if (layer.phase !== "staged") return;
														setLayers((current) => markLayerPageRendered(current, layer.id, pageNumber));
													}}
												/>
												<span className="cv-sheet-num">
													{pageNumber} / {layer.numPages}
												</span>
											</div>
										);
									})}
								</div>
							)}
						</PdfCanvasDocument>
					</div>
				))}
			</div>
		</div>
	);
}

function CVStudioMain() {
	const [cv, setCv] = useState<CV>(() => {
		try {
			const stored = localStorage.getItem(storageKey);
			return hydrateCv(stored ? { ...sample, ...JSON.parse(stored) } : sample);
		} catch {
			return sample;
		}
	});
	useEffect(() => {
		localStorage.setItem(storageKey, JSON.stringify(cv));
	}, [cv]);
	const baseName = useMemo(() => (cv.name || "CV").replace(/[^a-z0-9]+/gi, "_").replace(/^_|_$/g, ""), [cv.name]);
	const fileName = `${baseName}.pdf`;
	const exportData = () => {
		const blob = new Blob([JSON.stringify(cv, null, 2)], { type: "application/json" });
		const url = URL.createObjectURL(blob);
		const link = document.createElement("a");
		link.href = url;
		link.download = `${baseName}.json`;
		link.click();
		URL.revokeObjectURL(url);
	};
	const importData = (file?: File) => {
		if (!file) return;
		const reader = new FileReader();
		reader.onload = () => {
			try {
				setCv(hydrateCv({ ...sample, ...JSON.parse(String(reader.result)) }));
			} catch {
				window.alert("Fichier invalide : ce n'est pas un export CV Studio valide.");
			}
		};
		reader.readAsText(file);
	};
	return (
		<div className="cv-studio-app">
			<Editor cv={cv} setCv={setCv} />
			<section className="cv-stage">
				<div className="cv-toolbar">
					<div>
						<strong>Aperçu direct</strong>
						<span>Les données restent dans ton navigateur.</span>
					</div>
					<div className="cv-toolbar-actions">
						<button type="button" onClick={() => setCv(sample)}>
							Réinitialiser
						</button>
						<button type="button" onClick={exportData}>
							Exporter
						</button>
						<label className="cv-import-button">
							Importer
							<input
								type="file"
								accept="application/json"
								hidden
								onChange={(event) => {
									importData(event.target.files?.[0]);
									event.target.value = "";
								}}
							/>
						</label>
						<PDFDownloadLink className="cv-pdf-button" document={<CVPdf cv={cv} />} fileName={fileName}>
							Télécharger PDF
						</PDFDownloadLink>
					</div>
				</div>
				<PdfPreview cv={cv} />
			</section>
		</div>
	);
}

/**
 * Light client-side password gate. NOTE: this is a static site, so the password
 * lives in the bundle and can be bypassed by anyone technical — it only keeps
 * casual visitors out and is NOT real security.
 */
function PasswordGate({ children }: { children: React.ReactNode }) {
	const [unlocked, setUnlocked] = useState(() => sessionStorage.getItem("cv-studio-unlocked") === "1");
	const [value, setValue] = useState("");
	const [error, setError] = useState(false);
	if (unlocked) return <>{children}</>;
	const submit = (event: React.FormEvent) => {
		event.preventDefault();
		if (value.trim().toLowerCase() === atob("bm91cmhhaW5l")) {
			sessionStorage.setItem("cv-studio-unlocked", "1");
			setUnlocked(true);
		} else {
			setError(true);
		}
	};
	return (
		<div className="cv-gate">
			<form className="cv-gate-card" onSubmit={submit}>
				<div className="cv-gate-mark">
					<EgyptFlag />
				</div>
				<p>Espace protégé — entre le mot de passe pour continuer.</p>
				<input
					type="password"
					value={value}
					placeholder="Mot de passe"
					onChange={(event) => {
						setValue(event.target.value);
						setError(false);
					}}
				/>
				{error && <span className="cv-gate-error">Mot de passe incorrect.</span>}
				<button type="submit">Déverrouiller</button>
			</form>
		</div>
	);
}

export function CVStudioApp() {
	return (
		<PasswordGate>
			<CVStudioMain />
		</PasswordGate>
	);
}
