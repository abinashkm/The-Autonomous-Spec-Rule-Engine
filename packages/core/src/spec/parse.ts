import matter from 'gray-matter';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import { toString as nodeToString } from 'mdast-util-to-string';
import type { Root, Heading, List, ListItem } from 'mdast';
import {
  SpecFrontmatter,
  ParsedRequirements,
  ParsedTasks,
  type ParsedRequirements as ParsedRequirementsT,
  type ParsedTasks as ParsedTasksT,
  type Requirement as RequirementT,
  type AcceptanceCriterion as AcceptanceCriterionT,
  type TaskRow as TaskRowT,
} from '../schemas/spec.js';

/**
 * Markdown parsers for `requirements.md` and `tasks.md`.
 * Source of truth: run.md §7.1.
 *
 * Design:
 *   - gray-matter extracts frontmatter (YAML) and body (Markdown).
 *   - remark builds the AST; we walk H2/H3 headings to recognise sections.
 *   - Section layout (run.md §7.1):
 *       ## Context
 *       ## Requirements
 *       ### REQ-<n>: <title>
 *       - **AC-<n>.<m>**: <text>
 *       ## Non-functional
 *       ## Out of scope
 */

export class SpecParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SpecParseError';
  }
}

interface Section {
  readonly name: string;
  readonly children: Root['children'];
}

const REQ_HEADING_RE = /^(REQ-\d{3}):\s+(.+)$/;
const AC_LINE_RE = /^\s*\*{0,2}(AC-\d{3}\.\d+)\*{0,2}\s*:\s*(.+)$/;
const NFR_LINE_RE = /^\s*(NFR-\d{3})\s*:\s*(.+)$/;

function splitSections(root: Root): Section[] {
  const sections: Section[] = [];
  let current: Section = { name: '__preamble__', children: [] };
  for (const node of root.children) {
    if (node.type === 'heading' && (node as Heading).depth === 2) {
      sections.push(current);
      current = { name: nodeToString(node).trim(), children: [] };
    } else {
      (current.children as Root['children']).push(node);
    }
  }
  sections.push(current);
  return sections;
}

function parseRequirementsSection(section: Section): RequirementT[] {
  const out: RequirementT[] = [];
  let current: {
    id: string;
    title: string;
    acs: AcceptanceCriterionT[];
    deprecated: boolean;
  } | null = null;
  const flush = (): void => {
    if (!current) return;
    out.push({
      id: current.id,
      title: current.title,
      acceptanceCriteria: current.acs,
      deprecated: current.deprecated,
    });
    current = null;
  };
  for (const node of section.children) {
    if (node.type === 'heading' && (node as Heading).depth === 3) {
      flush();
      const text = nodeToString(node).trim();
      const match = REQ_HEADING_RE.exec(text);
      if (!match) {
        throw new SpecParseError(
          `H3 under 'Requirements' must look like 'REQ-xxx: title': "${text}"`,
        );
      }
      const title = match[2]!;
      const deprecated = /~~.*~~/.test(title);
      current = {
        id: match[1]!,
        title: title.replace(/^~~|~~$/g, '').trim(),
        acs: [],
        deprecated,
      };
      continue;
    }
    if (!current) continue; // top-level content before first REQ heading
    if (node.type === 'list') {
      for (const item of (node as List).children as ListItem[]) {
        const text = nodeToString(item).trim();
        const m = AC_LINE_RE.exec(text);
        if (!m) continue;
        const bodyText = m[2]!;
        const deprecated = /~~.*~~/.test(bodyText);
        current.acs.push({
          id: m[1]!,
          text: bodyText.replace(/^~~|~~$/g, '').trim(),
          deprecated,
        });
      }
    }
  }
  flush();
  return out;
}

function parseNfrSection(section: Section | undefined): { id: string; text: string }[] {
  if (!section) return [];
  const out: { id: string; text: string }[] = [];
  for (const node of section.children) {
    if (node.type !== 'list') continue;
    for (const item of (node as List).children as ListItem[]) {
      const text = nodeToString(item).trim();
      const m = NFR_LINE_RE.exec(text);
      if (m) out.push({ id: m[1]!, text: m[2]! });
    }
  }
  return out;
}

function parseStringList(section: Section | undefined): string[] {
  if (!section) return [];
  const out: string[] = [];
  for (const node of section.children) {
    if (node.type !== 'list') continue;
    for (const item of (node as List).children as ListItem[]) {
      const text = nodeToString(item).trim();
      if (text) out.push(text);
    }
  }
  return out;
}

/** gray-matter + js-yaml auto-coerce `YYYY-MM-DD` into a Date. The schema
 *  expects a string, so normalise known date-typed fields back to ISO date. */
function normalizeFrontmatter(data: Record<string, unknown>): Record<string, unknown> {
  const out = { ...data };
  if (out.created instanceof Date) {
    const d = out.created;
    const yyyy = d.getUTCFullYear();
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(d.getUTCDate()).padStart(2, '0');
    out.created = `${yyyy}-${mm}-${dd}`;
  }
  return out;
}

export function parseRequirements(raw: string): ParsedRequirementsT {
  const parsed = matter(raw);
  const frontmatter = SpecFrontmatter.parse(normalizeFrontmatter(parsed.data));
  const ast = unified().use(remarkParse).parse(parsed.content) as Root;
  const sections = splitSections(ast);

  const sectionByName = new Map<string, Section>();
  for (const s of sections) {
    sectionByName.set(s.name.toLowerCase(), s);
  }

  const requirementsSection = sectionByName.get('requirements');
  if (!requirementsSection) {
    throw new SpecParseError(`Missing '## Requirements' section in ${frontmatter.id}`);
  }

  const context = (sectionByName.get('context')?.children ?? [])
    .map((n: Root['children'][number]) => nodeToString(n))
    .join('\n')
    .trim();

  return ParsedRequirements.parse({
    frontmatter,
    context,
    requirements: parseRequirementsSection(requirementsSection),
    nonFunctional: parseNfrSection(sectionByName.get('non-functional')),
    outOfScope: parseStringList(sectionByName.get('out of scope')),
  });
}

/* ----------------------------- tasks ---------------------------------- */

const TASK_LINE_RE =
  /^\[(x|X| )\]\s+\*{0,2}(T-\d{3})\*{0,2}\s+(.+?)(?:\s+—\s+implements:\s+([^—]+))?(?:\s+—\s+tags:\s+(.+))?$/;

function parseTasksAst(ast: Root): TaskRowT[] {
  const out: TaskRowT[] = [];
  const walk = (nodes: Root['children']): void => {
    for (const node of nodes) {
      if (node.type === 'list') {
        for (const item of (node as List).children as ListItem[]) {
          const text = nodeToString(item).replace(/\s+/g, ' ').trim();
          const m = TASK_LINE_RE.exec(text);
          if (!m) continue;
          const done = (m[1] ?? '').toLowerCase() === 'x';
          const id = m[2]!;
          const title = m[3]!.trim().replace(/^\*+|\*+$/g, '');
          const implementsText = (m[4] ?? '').trim();
          const tagsText = (m[5] ?? '').trim();
          const impls = implementsText
            ? implementsText
                .split(',')
                .map((s) => s.trim())
                .filter(Boolean)
            : [];
          const tags = tagsText
            ? tagsText
                .split(',')
                .map((s) => s.trim())
                .filter(Boolean)
            : [];
          out.push({ id, title, done, implements: impls, tags });
        }
      }
    }
  };
  walk(ast.children);
  return out;
}

export function parseTasks(raw: string): ParsedTasksT {
  const parsed = matter(raw);
  const ast = unified().use(remarkParse).parse(parsed.content) as Root;
  return ParsedTasks.parse({ tasks: parseTasksAst(ast) });
}
