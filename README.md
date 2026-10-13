# md-notes

A lightweight, elegant Markdown notes tool built with a Rust-powered backend and a modern TypeScript frontend.

## ✨ Features

- Fast and responsive note management
- Markdown-first writing experience
- Clean, minimal interface
- Local-first workflow for private notes

## 🧱 Tech Stack

- **Rust** (core/backend)
- **TypeScript** (frontend)
- **CSS + HTML** (UI layer)

## 📦 Installation

### Prerequisites

- [Rust](https://www.rust-lang.org/tools/install) (stable)
- [Node.js](https://nodejs.org/) (LTS recommended)
- A package manager: `npm`, `pnpm`, or `yarn`

### Clone the repository

```bash
git clone https://github.com/YoavTC/md-notes.git
cd md-notes
```

### Install dependencies

```bash
# frontend deps (choose one)
npm install
# or
pnpm install
# or
yarn install
```

## 🛠️ Build locally

### Build frontend

```bash
npm run build
```

### Build Rust backend

```bash
cargo build --release
```

## ▶️ Run locally

```bash
# start frontend dev server
npm run dev

# in another terminal, run backend
cargo run
```

## 🎬 Showcase

<!-- Replace with your demo gif/video -->
![Showcase placeholder](./docs/showcase.gif)

_If you don't have a demo yet, keep this placeholder and add your media later._

## 📁 Project Structure (high-level)

```text
.
├── src/                # TypeScript/frontend source
├── styles/             # CSS
├── backend/ or crates/ # Rust backend (adjust to your actual layout)
└── README.md
```

## 🤝 Contributing

Contributions, ideas, and improvements are welcome. Open an issue or submit a pull request.

## 📄 License

Add your license here (e.g., MIT, Apache-2.0).
