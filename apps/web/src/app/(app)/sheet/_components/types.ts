export type ProblemStatusValue = "NOT_STARTED" | "IN_PROGRESS" | "SOLVED";

export type DifficultyValue = "EASY" | "MEDIUM" | "HARD";

export interface SheetProblem {
  id: string;
  slug: string;
  title: string;
  reference: string | null;
  difficulty: DifficultyValue;
  leetcodeUrl: string | null;
  gfgUrl: string | null;
  youtubeUrl: string | null;
  companies: { name: string; logoUrl: string | null }[];
  status: ProblemStatusValue;
  hasNote: boolean;
  isBookmarked: boolean;
}

export interface SheetPattern {
  id: string;
  name: string;
  strategy: string | null;
  identification: string | null;
  problems: SheetProblem[];
}

export interface TopicPayload {
  patterns: SheetPattern[];
}

export interface TopicMeta {
  id: string;
  name: string;
  description: string | null;
  problemCount: number;
  solvedCount: number;
  patterns: SheetPattern[];
}

export interface SheetMeta {
  id: string;
  /** URL segment — `/sheet/<slug>` is this sheet's own indexable page. */
  slug: string;
  name: string;
  description: string | null;
  topics: TopicMeta[];
}
