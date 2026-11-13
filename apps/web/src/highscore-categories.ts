import {
  emptyCategoryHighscores,
  HIGHSCORE_CATEGORY_IDS,
  type CategoryHighscores,
} from "@starhold/game";
import { fetchCategoryHighscores } from "./api";
import { schedulePaint } from "./session";
import { categoryBoardsEmpty, setCategoryBoards } from "./ui/render-pages";

let lastPage = "";
let pending = false;

function isEmpty(boards: CategoryHighscores): boolean {
  return HIGHSCORE_CATEGORY_IDS.every((id) => boards[id].length === 0);
}

/**
 * Load cached category boards when the highscore page is opened.
 * Staying on the page, including the 30s poll, does not ask again.
 */
export function syncCategoryBoards(page: string): void {
  if (page !== "highscore") {
    lastPage = page;
    return;
  }
  if (lastPage === "highscore" || pending) return;
  lastPage = "highscore";
  pending = true;
  void fetchCategoryHighscores()
    .then((boards) => {
      const next = normalizeCategoryBoards(boards);
      if (categoryBoardsEmpty() && isEmpty(next)) return;
      setCategoryBoards(next);
      schedulePaint();
    })
    .catch(() => {
      /* a missing cache stays an empty list */
    })
    .finally(() => {
      pending = false;
    });
}

function normalizeCategoryBoards(boards: Partial<CategoryHighscores> | null): CategoryHighscores {
  const empty = emptyCategoryHighscores();
  return {
    buildings: Array.isArray(boards?.buildings) ? boards.buildings : empty.buildings,
    fleet: Array.isArray(boards?.fleet) ? boards.fleet : empty.fleet,
    research: Array.isArray(boards?.research) ? boards.research : empty.research,
    defense: Array.isArray(boards?.defense) ? boards.defense : empty.defense,
  };
}
