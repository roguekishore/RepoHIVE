/*
 * Content config — the SINGLE source of truth for all copy on the page.
 * All text is RepoHIVE's own (drawn from the project's steering docs).
 * Navigation labels are intentionally placeholders.
 * No copy is hardcoded inside components; everything is read from here.
 */

export type NavItem = { label: string; href: string };

export type Stat = { value: string; label: string };

export type MetricCard = { value: string; title: string; body: string };

export type FeatureCard = {
  icon: string;
  title: string;
  body: string;
  link: string;
};

export type ListItem = { title: string; body: string };

export type InterfaceCard = {
  icon: string;
  name: string;
  audience: string;
  lines: string[];
};

export type SplitFeature = {
  eyebrow: string;
  title: string;
  titleEm?: string;
  points: string[];
  mockup: "graph" | "health" | "git" | "wiki" | "decisions";
  reverse?: boolean;
};

export const content = {
  brand: {
    name: "RepoHIVE",
    install: "npx repohive",
    star: "2.6k",
  },

  // Placeholder navigation, as requested.
  nav: [
    { label: "Product", href: "#" },
    { label: "Engine", href: "#" },
    { label: "Research", href: "#" },
    { label: "Docs", href: "#" },
    { label: "Paper", href: "#" },
  ] as NavItem[],

  cta: {
    primary: "Get started",
    secondary: "Sign in",
  },

  hero: {
    eyebrow: "HIERARCHICAL CODEBASE INTELLIGENCE · DETERMINISTIC · LOCAL-FIRST",
    title: ["A graph your AI can navigate.", "A hierarchy your team can"],
    titleEm: "trust.",
    body: "RepoHIVE turns a flat 4,000-file dependency tangle into a navigable, multi-level hierarchy. Adaptive per-region construction preserves the parts that are well-built and rebuilds only the messy ones — every decision recorded, every run reproducible.",
    searchPlaceholder: "github.com/owner/java-repo — point it at any repo",
    searchButton: "Index",
  },

  stats: [
    { value: "4", label: "Hierarchy levels" },
    { value: "3", label: "Pipeline stages" },
    { value: "100%", label: "Deterministic runs" },
    { value: "Java", label: "Phase-1 target" },
  ] as Stat[],

  metrics: [
    {
      value: "Repo → fn",
      title: "four navigable levels",
      body: "Repository → Groups → Files → Functions. See the big regions, zoom into one, never render all 4,000 nodes at once.",
    },
    {
      value: "per-region",
      title: "adaptive construction",
      body: "Each region's cohesion and coupling is measured; well-structured packages are preserved, poorly-structured ones reconstructed.",
    },
    {
      value: "0 random",
      title: "fully reproducible",
      body: "Seeded community detection over canonically-ordered nodes. No Math.random, no timestamps — identical input, identical hierarchy.",
    },
  ] as MetricCard[],

  audience: {
    eyebrow: "WHO IT'S FOR",
    title: "One index.",
    titleEm: "Every reader it serves.",
    body: "RepoHIVE indexes a repo once and serves both the humans onboarding to it and the agents writing against it. Find the path built for you.",
    cards: [
      {
        icon: "▢",
        title: "Human developers",
        body: "Onboard to a huge repo like a map: see the regions, descend into the one you need.",
        link: "Explore",
      },
      {
        icon: "⌥",
        title: "AI coding agents",
        body: "Retrieve the right context without reading the whole repo — descend the hierarchy to the relevant branch.",
        link: "Explore",
      },
      {
        icon: "◎",
        title: "Reviewers & leads",
        body: "Trace blast radius across the dependency graph before a change lands.",
        link: "Explore",
      },
      {
        icon: "⛁",
        title: "Researchers",
        body: "An auditable, deterministic baseline for structural clustering experiments.",
        link: "Explore",
      },
    ] as FeatureCard[],
  },

  twoAudiences: {
    eyebrow: "ONE INDEX, TWO AUDIENCES",
    title: "Built for the agents reading your code,",
    titleEm: "and the people who own it.",
    body: "RepoHIVE builds the hierarchy once. The same structure makes agent retrieval cheaper and human navigation faster.",
    left: {
      label: "FOR YOUR AI AGENTS",
      heading: "Context they can use",
      items: [
        { title: "Branch retrieval", body: "Load only the relevant subtree, not the whole repo." },
        { title: "Dependency-aware", body: "Real import/call edges, not folder guesses." },
        { title: "Stable IDs", body: "Deterministic node identity across re-indexes." },
      ] as ListItem[],
    },
    right: {
      label: "FOR YOUR TEAM",
      heading: "Structure they can trust",
      items: [
        { title: "Auditable decisions", body: "Every preserve-vs-reconstruct call is recorded." },
        { title: "Blast radius", body: "See which regions a change can reach." },
        { title: "Reproducible", body: "Same repo in, same hierarchy out, every time." },
      ] as ListItem[],
    },
  },

  howItWorks: {
    eyebrow: "01 HOW IT WORKS",
    title: "One engine,",
    titleEm: "three stages",
    body: "Run it once. Each stage is a stateless file-handoff — read JSON, write JSON, exit. The contract between them is the stable seam.",
    interfaces: [
      {
        icon: ">_",
        name: "parse",
        audience: "JAVA REPO → GRAPH",
        lines: [
          "$ npx repohive parse ./repo",
          "→ tree-sitter per-file ASTs",
          "→ stitch cross-file edges",
          "→ write graph.json",
        ],
      },
      {
        icon: "✦",
        name: "group",
        audience: "GRAPH → HIERARCHY",
        lines: [
          "$ npx repohive group graph.json",
          "→ assess region quality",
          "→ preserve | reconstruct",
          "→ write index/*.json",
        ],
      },
      {
        icon: "▤",
        name: "view",
        audience: "HIERARCHY → BROWSER",
        lines: [
          "$ npx repohive view index/",
          "→ localhost:7337/map",
          "→ localhost:7337/region",
          "→ localhost:7337/flat",
        ],
      },
    ] as InterfaceCard[],
  },

  layers: {
    eyebrow: "02 THE CONTRIBUTION",
    title: "Most tools cluster one way.",
    titleEm: "RepoHIVE decides per region.",
    body: "Cohesion, coupling, package boundaries, dependency topology, and recorded provenance — the signals that compound into a hierarchy you can defend.",
    features: [
      {
        eyebrow: "GRAPH",
        title: "Every dependency,",
        titleEm: "stitched and weighted",
        points: [
          "Tree-sitter ASTs across the repo → directed dependency graph",
          "Edge signals: import frequency, method calls, shared types",
          "Cross-file stitching turns per-file ASTs into one graph",
          "Scales to thousands of files on a commodity laptop",
        ],
        mockup: "graph",
      },
      {
        eyebrow: "QUALITY",
        title: "It measures each region",
        titleEm: "before it groups it",
        points: [
          "Per-region cohesion and coupling scoring drives the decision",
          "Well-structured packages are preserved as-is",
          "Poorly-structured regions are rebuilt with community detection",
          "Graceful degradation: never worse than a single global pass",
        ],
        mockup: "health",
        reverse: true,
      },
      {
        eyebrow: "DETERMINISM",
        title: "The same repo always",
        titleEm: "builds the same hierarchy",
        points: [
          "Seeded PRNG over canonically-sorted nodes and edges",
          "No Math.random, no timestamps or counters in IDs",
          "Louvain behind a swappable CommunityDetector interface",
          "Every score and parameter recorded for audit",
        ],
        mockup: "git",
      },
      {
        eyebrow: "HIERARCHY",
        title: "Levels that stay",
        titleEm: "readable at any depth",
        points: [
          "Repository → Groups → Files → Functions",
          "~5–7 things per level instead of one flat pile",
          "Semantic zoom: only one level rendered at a time",
          "Flat baseline kept side-by-side as the comparison",
        ],
        mockup: "wiki",
        reverse: true,
      },
    ] as SplitFeature[],
  },

  claims: {
    eyebrow: "◎ THE TWO CLAIMS",
    title: "Flat doesn't scale.",
    titleEm: "Hierarchy does.",
    body: "RepoHIVE makes two separate, honest claims — each with its caveat stated openly. We win in one narrow, defensible slice, and we say exactly where.",
    cards: [
      { value: "A", tag: "NAVIGATION", body: "Hierarchy beats flat for navigation and retrieval — a tree shows a handful of things per level instead of an unreadable tangle." },
      { value: "B", tag: "ADAPTIVE", body: "Adaptive beats single-global clustering on mixed-quality repos. A hypothesis to prove, not a theorem — never worse, strictly better on mixed." },
      { value: "!", tag: "CAVEAT", body: "Blast radius is static reachability; it can under-count dynamic edges like reflection and dependency injection. We say so." },
    ],
    ctaPrimary: "Read the approach",
    ctaSecondary: "For reviewers",
  },

  prBot: {
    eyebrow: "03 BLAST RADIUS",
    title: "Know what a change can reach",
    titleEm: "before it lands",
    body: "Point RepoHIVE at a file and it lights up every region statically reachable through the dependency graph. Deterministic, explainable, no model in the loop.",
    points: [
      { title: "Region-level impact", body: "Impacted groups light up across the hierarchy." },
      { title: "Static reachability", body: "Walks real import and call edges, not folders." },
      { title: "Honest about limits", body: "Flags that dynamic edges may be under-counted." },
      { title: "Zero model cost", body: "Pure graph traversal — fast and reproducible." },
    ],
    ctaPrimary: "See blast radius",
    ctaSecondary: "View on GitHub",
    mockupTitle: "repohive · impact for auth/middleware.java",
  },

  mcp: {
    eyebrow: "04 THE JSON CONTRACT",
    title: "One stable seam",
    titleEm: "everything plugs into",
    body: "The parser writes it; the engine, the viewer, and every future wrapper read it. New consumers attach with zero engine rework as long as the contract holds.",
    tools: [
      { name: "graph.json", body: "Nodes + weighted dependency edges — the parser's single output." },
      { name: "repository.json", body: "Top-level summary: region count, levels, build parameters." },
      { name: "hierarchy.json", body: "The navigable tree: Repository → Groups → Files → Functions." },
      { name: "nodes.json", body: "Every node with kind, package path, and directory path." },
      { name: "edges.json", body: "Import frequency, method-call frequency, shared-type count." },
      { name: "metadata.json", body: "Per-region preserve-vs-reconstruct decisions and scores." },
      { name: "GraphNode", body: "id · kind (file|function|class) · packagePath · directoryPath." },
      { name: "DependencyEdge", body: "source · target · strength derived from the raw signals." },
      { name: "deterministic", body: "Stable IDs and ordering make every artifact diff-friendly." },
    ],
  },

  pricing: {
    items: [
      {
        title: "Local engine — free, forever",
        install: "npx repohive",
        body: "Your machine, your files · the full parse → group → view pipeline · code never leaves your laptop",
      },
      {
        title: "Deferred ecosystem — 8th sem",
        accent: "Skill · MCP server · VS Code extension",
        body: "All wrap the same engine and read the same JSON contract — none change the core.",
      },
      {
        title: "Research artifacts",
        body: "Reproducible runs · auditable decisions · a deterministic baseline for the paper",
      },
    ],
    form: {
      tabs: ["Research question", "Collaboration", "Just saying hi"],
      label: "Message (optional)",
      placeholder: "Tell us about your repo, its size, or what you'd like to navigate…",
      button: "Send",
    },
  },

  footer: {
    tagline: "Hierarchical codebase intelligence. Deterministic, local-first, and built to be auditable.",
    columns: [
      {
        title: "ENGINE",
        links: ["parse", "group", "view", "Blast radius", "JSON contract"],
      },
      {
        title: "RESEARCH",
        links: ["The approach", "Two claims", "Baseline", "Paper"],
      },
      {
        title: "PROJECT",
        links: ["Roadmap", "Reviews", "Steering", "About"],
      },
    ],
    status: "All stages reproducible",
    copyright: "© 2026 RepoHIVE",
    email: "hello@repohive.dev",
  },
};

export type Content = typeof content;
