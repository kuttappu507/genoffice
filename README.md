# GenOffice — OpenRouter & NVIDIA NIM Fork

An AI-native desktop office suite for Windows/macOS with a word processor, spreadsheet, presentations and PDF tools. This fork extends the upstream GenOffice project with bring-your-own-key AI access through OpenRouter and direct NVIDIA NIM, while retaining the upstream office-engine improvements.

## Upstream sync

This fork periodically incorporates upstream GenOffice improvements. The latest sync includes upstream PDF editing/form/annotation improvements, Sheets validation and stability improvements, system font support, shared Office UI improvements, and AI network resilience.

## Fork AI features

- **OpenRouter BYOK** — enter your own OpenRouter API key inside the application.
- **OpenRouter Free Router** — use `openrouter/free` when available.
- **NVIDIA NIM Direct** — use an NVIDIA `nvapi-...` key without routing through OpenRouter.
- **Multiple NVIDIA models** — experiment with supported Nemotron, Kimi, DeepSeek, Qwen and MiniMax endpoints as available from NVIDIA.
- **Shared provider configuration** — Docs, Sheets and Slides use the shared configurable AI provider layer.
- **Streaming + tool calling** — retains GenOffice's agent-based document, workbook and presentation editing workflow.
- **Real provider errors** — provider/capacity errors are surfaced directly instead of being converted into a Genspark login prompt.
- **Local key configuration** — API credentials are configured in the desktop application rather than embedded into the Windows build.

## Apps

| App | Product | What it is |
| --- | --- | --- |
| `apps/docs` | **GenOffice Docs** | `.docx` word processor with paginated editing, tracked changes, comments, styles, equations and AI editing. |
| `apps/sheets` | **GenOffice Sheets** | `.xlsx` spreadsheet editor with import/export, charts, pivots, validation and AI workbook tools. |
| `apps/slides` | **GenOffice Slides** | `.pptx` presentation editor with parse/render/edit and AI slide tools. |
| `apps/pdf` | **GenOffice PDF** | `.pdf` viewer/editor using pdf.js + pdf-lib, including upstream editing and annotation improvements. |
| `apps/shell` | **GenOffice** | Electron suite shell hosting the editors and shared configuration. |

## Development

```bash
npm install
npm test
npm run typecheck
npm run dev
npm run build:all
npm run dist:win
```

The Sheets app additionally needs a Rust toolchain for its XLSX sidecar.

## Security

API keys are user-supplied credentials. Do not commit API keys to this repository or bake personal keys into public builds. Treat documents sent to an AI provider according to that provider's privacy and data-handling terms.

## Upstream project

This repository is a fork/customization of **GenOffice by Mainfunc/Genspark**. The upstream project supplies the core office editors and engine improvements; this fork focuses on configurable direct AI-provider access and Android work.

## License

GenOffice is licensed under the Apache License 2.0, with the upstream exception for the `ee/` directory described in `ee/LICENSE`.
