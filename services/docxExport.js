'use strict';

/**
 * Render a saved draft to a .docx Buffer using the `docx` library. Plain,
 * formal layout suitable for committee submissions: a heading, a context line,
 * then the body split into paragraphs on blank lines.
 */

const { Document, Packer, Paragraph, TextRun, HeadingLevel } = require('docx');

const OUTPUT_LABELS = {
  quote: 'Media quote',
  press_response: 'Press response',
  briefing_note: 'Briefing note',
  committee_submission: 'Committee submission',
  mp_email: 'MP engagement email',
};

function toParagraphs(text) {
  return String(text || '')
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => new Paragraph({
      children: block.split('\n').map((line, i) =>
        new TextRun({ text: line, break: i > 0 ? 1 : 0 })),
      spacing: { after: 200 },
    }));
}

async function buildDocx(draft) {
  const label = OUTPUT_LABELS[draft.output_type] || 'Draft';
  const heading = new Paragraph({
    text: `${label} — De Montfort University`,
    heading: HeadingLevel.HEADING_1,
  });
  const context = new Paragraph({
    children: [new TextRun({ text: draft.item_title || '', italics: true, color: '666666' })],
    spacing: { after: 300 },
  });

  const doc = new Document({
    creator: 'DMU Parliamentary Intelligence Tool',
    title: `${label} — ${draft.item_title || ''}`.slice(0, 120),
    sections: [{ children: [heading, context, ...toParagraphs(draft.content)] }],
  });

  return Packer.toBuffer(doc);
}

function fileName(draft) {
  const slug = (draft.item_title || draft.output_type || 'draft')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
  return `dmu-${draft.output_type || 'draft'}-${slug || draft.id}.docx`;
}

module.exports = { buildDocx, fileName, OUTPUT_LABELS };
