export const projects = [
  {
    id: 1,
    title: "Build a responsive portfolio website",
    description: "Design and build a polished portfolio for a product designer, with a fast, accessible experience on every device.",
    budget: 100,
    deadline: "14 days",
    skills: ["React", "TypeScript", "Tailwind CSS"],
    proposals: 12,
    client: "Elena Rossi",
    verified: true,
  },
  {
    id: 2,
    title: "Redesign a fintech onboarding flow",
    description: "Turn our existing onboarding into a clear, trustworthy five-step journey with responsive screens.",
    budget: 450,
    deadline: "10 days",
    skills: ["Figma", "UX Design", "Prototyping"],
    proposals: 8,
    client: "Marcus Chen",
    verified: true,
  },
  {
    id: 3,
    title: "React analytics dashboard",
    description: "Build a responsive analytics dashboard with charts, filters, and export-ready reporting.",
    budget: 680,
    deadline: "21 days",
    skills: ["React", "Data Viz", "API"],
    proposals: 19,
    client: "Sofia Patel",
    verified: true,
  },
  {
    id: 4,
    title: "Illustrate a web3 learning guide",
    description: "Create a friendly set of editorial illustrations for a beginner-focused digital finance guide.",
    budget: 320,
    deadline: "12 days",
    skills: ["Illustration", "Branding", "Figma"],
    proposals: 6,
    client: "Noah Williams",
    verified: false,
  },
  {
    id: 5,
    title: "Design system audit and cleanup",
    description: "Review our component library, find inconsistencies, and deliver a prioritized cleanup plan.",
    budget: 520,
    deadline: "18 days",
    skills: ["Design Systems", "Accessibility"],
    proposals: 10,
    client: "Amara Okafor",
    verified: true,
  },
  {
    id: 6,
    title: "Conversion copy for SaaS homepage",
    description: "Rewrite our homepage to clarify positioning and turn more trial visitors into qualified leads.",
    budget: 240,
    deadline: "7 days",
    skills: ["Copywriting", "SaaS", "SEO"],
    proposals: 14,
    client: "Liam Cooper",
    verified: true,
  },
];

export const freelancers = [
  { name: "Maya Chen", role: "Frontend developer", rating: 4.9, jobs: 42, price: 95, delivery: "10 days", initials: "MC", wallet: "0x12f4...89ab" },
  { name: "Daniel Okafor", role: "Product designer", rating: 4.8, jobs: 31, price: 100, delivery: "12 days", initials: "DO", wallet: "0x83c1...27de" },
  { name: "Ines Martin", role: "Full-stack engineer", rating: 5.0, jobs: 27, price: 110, delivery: "8 days", initials: "IM", wallet: "0xa920...31cc" },
  { name: "Jon Bell", role: "Web developer", rating: 4.7, jobs: 19, price: 90, delivery: "14 days", initials: "JB", wallet: "0x77b3...42fa" },
  { name: "Priya Shah", role: "UX engineer", rating: 4.9, jobs: 36, price: 105, delivery: "9 days", initials: "PS", wallet: "0x441d...99be" },
];

export const requirements = [
  "Responsive layout",
  "About section",
  "Projects section",
  "Contact form",
  "Mobile support",
];

export const transactions = [
  { type: "Release", project: "Portfolio website", amount: "+100.00 PYUSD", date: "May 24, 2025", status: "Confirmed", hash: "0x76a9...21ef" },
  { type: "Fund", project: "Fintech onboarding", amount: "-450.00 PYUSD", date: "May 21, 2025", status: "Confirmed", hash: "0xb218...71ac" },
  { type: "Refund", project: "SEO content audit", amount: "+85.00 PYUSD", date: "May 18, 2025", status: "Confirmed", hash: "0x11cf...82dd" },
  { type: "Fund", project: "Analytics dashboard", amount: "-680.00 PYUSD", date: "May 16, 2025", status: "Pending", hash: "0x98aa...14cb" },
];

export const notifications = [
  { title: "You were hired", detail: "Elena hired you for Portfolio website", time: "2m" },
  { title: "Escrow funded", detail: "100 PYUSD is secured and ready", time: "1h" },
  { title: "Work submitted", detail: "Maya submitted final deliverables", time: "3h" },
  { title: "Payment released", detail: "You received 450 PYUSD", time: "1d" },
];

export const testimonials = [
  { quote: "Freelancia removed the awkwardness from payment conversations. We both knew the funds were safe.", name: "Olivia Hart", role: "Founder, Linear Labs" },
  { quote: "The verification report helps clients review my work faster without replacing the human decision.", name: "Theo Grant", role: "Independent developer" },
  { quote: "I hired three specialists in a month and every milestone was transparent from start to finish.", name: "Samira Noor", role: "Product lead" },
];
