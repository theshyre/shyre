"use client";

import { Fragment } from "react";
import { Text, View, StyleSheet } from "@react-pdf/renderer";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";

/**
 * Render markdown as @react-pdf/renderer primitives. react-pdf has no markdown
 * (or HTML) support, so we parse the source to an mdast tree with the SAME
 * remark stack the on-screen `<MarkdownView>` uses (parity between the web and
 * the PDF), then walk it to `<Text>`/`<View>`.
 *
 * Fonts are the PDF's built-in PostScript families (no `Font.register`):
 * bold → Helvetica-Bold, italic → Helvetica-Oblique, code → Courier, else
 * Helvetica. Parsing is synchronous (`.parse()` — no transform pipeline), so
 * this renders inline during the react-pdf pass.
 */

interface MdNode {
  type: string;
  value?: string;
  depth?: number;
  ordered?: boolean;
  children?: MdNode[];
  url?: string;
}

const processor = unified().use(remarkParse).use(remarkGfm);

const ink = "#111827";
const inkSecondary = "#374151";
const ruleSoft = "#e5e7eb";

const s = StyleSheet.create({
  para: { fontSize: 10, color: inkSecondary, marginBottom: 4, lineHeight: 1.4 },
  h: {
    fontSize: 10,
    fontFamily: "Helvetica-Bold",
    color: ink,
    marginTop: 4,
    marginBottom: 2,
  },
  bulletRow: { flexDirection: "row", marginBottom: 2 },
  bulletMark: { width: 12, fontSize: 10, color: inkSecondary },
  bulletBody: { flex: 1 },
  hr: { borderBottomWidth: 0.5, borderBottomColor: ruleSoft, marginVertical: 4 },
  quote: {
    borderLeftWidth: 1,
    borderLeftColor: ruleSoft,
    paddingLeft: 8,
    marginBottom: 4,
  },
  code: {
    fontSize: 9,
    fontFamily: "Courier",
    color: inkSecondary,
    marginBottom: 4,
  },
  tableRow: { flexDirection: "row" },
  th: {
    flex: 1,
    fontSize: 9,
    fontFamily: "Helvetica-Bold",
    color: ink,
    borderWidth: 0.5,
    borderColor: ruleSoft,
    padding: 3,
  },
  td: {
    flex: 1,
    fontSize: 9,
    color: inkSecondary,
    borderWidth: 0.5,
    borderColor: ruleSoft,
    padding: 3,
  },
  tableWrap: { marginBottom: 4 },
});

/** Phrasing (inline) content → strings + nested <Text> runs. */
function renderInline(nodes: MdNode[], keyPrefix: string): React.ReactNode[] {
  return nodes.map((n, i) => {
    const key = `${keyPrefix}-${i}`;
    switch (n.type) {
      case "text":
        return <Fragment key={key}>{n.value}</Fragment>;
      case "strong":
        return (
          <Text key={key} style={{ fontFamily: "Helvetica-Bold" }}>
            {renderInline(n.children ?? [], key)}
          </Text>
        );
      case "emphasis":
        return (
          <Text key={key} style={{ fontFamily: "Helvetica-Oblique" }}>
            {renderInline(n.children ?? [], key)}
          </Text>
        );
      case "inlineCode":
        return (
          <Text key={key} style={{ fontFamily: "Courier" }}>
            {n.value}
          </Text>
        );
      case "delete":
        return (
          <Text key={key} style={{ textDecoration: "line-through" }}>
            {renderInline(n.children ?? [], key)}
          </Text>
        );
      case "link":
        return (
          <Text key={key} style={{ color: "#2563eb", textDecoration: "underline" }}>
            {renderInline(n.children ?? [], key)}
          </Text>
        );
      case "break":
        return <Fragment key={key}>{"\n"}</Fragment>;
      default:
        return (
          <Fragment key={key}>
            {n.children ? renderInline(n.children, key) : (n.value ?? "")}
          </Fragment>
        );
    }
  });
}

/** Block (flow) content → <Text>/<View>. */
function renderBlock(node: MdNode, key: string): React.ReactNode {
  switch (node.type) {
    case "paragraph":
      return (
        <Text key={key} style={s.para}>
          {renderInline(node.children ?? [], key)}
        </Text>
      );
    case "heading":
      return (
        <Text key={key} style={s.h}>
          {renderInline(node.children ?? [], key)}
        </Text>
      );
    case "thematicBreak":
      return <View key={key} style={s.hr} />;
    case "blockquote":
      return (
        <View key={key} style={s.quote}>
          {(node.children ?? []).map((c, i) => renderBlock(c, `${key}-${i}`))}
        </View>
      );
    case "list":
      return (
        <View key={key}>
          {(node.children ?? []).map((li, i) => (
            <View key={`${key}-${i}`} style={s.bulletRow}>
              <Text style={s.bulletMark}>{node.ordered ? `${i + 1}.` : "•"}</Text>
              <View style={s.bulletBody}>
                {(li.children ?? []).map((c, j) =>
                  renderBlock(c, `${key}-${i}-${j}`),
                )}
              </View>
            </View>
          ))}
        </View>
      );
    case "code":
      return (
        <Text key={key} style={s.code}>
          {node.value}
        </Text>
      );
    case "table":
      return (
        <View key={key} style={s.tableWrap}>
          {(node.children ?? []).map((row, ri) => (
            <View key={`${key}-${ri}`} style={s.tableRow}>
              {(row.children ?? []).map((cell, ci) => (
                <Text
                  key={`${key}-${ri}-${ci}`}
                  style={ri === 0 ? s.th : s.td}
                >
                  {renderInline(cell.children ?? [], `${key}-${ri}-${ci}`)}
                </Text>
              ))}
            </View>
          ))}
        </View>
      );
    default:
      return node.children ? (
        <View key={key}>
          {node.children.map((c, i) => renderBlock(c, `${key}-${i}`))}
        </View>
      ) : null;
  }
}

export function MarkdownPdf({ content }: { content: string }): React.JSX.Element {
  const tree = processor.parse(content) as unknown as MdNode;
  return (
    <>{(tree.children ?? []).map((n, i) => renderBlock(n, `md-${i}`))}</>
  );
}
