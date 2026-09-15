// Parser for prompts/*.md (front-matter `version`, sections `system`, `user_template`, `example_json`). Pure.

export interface PromptFile {
  version: string
  system: string
  userTemplate: string
  exampleJson: string
}

const SECTION = /^## (system|user_template|example_json)\s*$/gm

export function parsePromptFile(md: string): PromptFile {
  const text = md.replace(/\r\n?/g, '\n')
  const fm = /^---\n([\s\S]*?)\n---\n/.exec(text)
  if (!fm) throw new Error('prompt file: missing front-matter')
  const version = /^version:\s*(\S+)\s*$/m.exec(fm[1])?.[1]
  if (!version) throw new Error('prompt file: front-matter has no version')
  const body = text.slice(fm[0].length)
  const marks = [...body.matchAll(SECTION)]
  const sections: Record<string, string> = {}
  marks.forEach((m, i) => {
    const start = (m.index ?? 0) + m[0].length
    const end = i + 1 < marks.length ? (marks[i + 1].index ?? body.length) : body.length
    if (sections[m[1]] !== undefined) throw new Error(`prompt file ${version}: duplicate section ${m[1]}`)
    sections[m[1]] = body.slice(start, end).trim()
  })
  for (const name of ['system', 'user_template', 'example_json']) {
    if (!sections[name]) throw new Error(`prompt file ${version}: missing section ${name}`)
  }
  JSON.parse(sections.example_json) // example must be valid JSON
  return { version, system: sections.system, userTemplate: sections.user_template, exampleJson: sections.example_json }
}

/** Replaces `{{name}}` placeholders; unknown placeholders throw so a template typo cannot reach the model. */
export function fillTemplate(template: string, values: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_m, name: string) => {
    if (!(name in values)) throw new Error(`prompt template: no value for {{${name}}}`)
    return values[name]
  })
}
