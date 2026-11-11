/**
 * The Assignments card's header keeps its actions in two menus (the
 * AssignmentsPage board): Set Everyone To ▾ and ⋯ (Class Results, Print,
 * Work Wall, Grade by, Checklists, Edit Assessment, Duplicate, Copy to
 * Another Class…, Delete…). `cardMenuItem` opens the menu that holds the
 * action and returns its item, ready to click.
 */
export async function cardMenuItem(card, action, extra = '') {
  const sel = '.assess-menu [data-action="' + action + '"]' + extra;
  const item = card.locator(sel).first();
  if (!(await item.isVisible())) {
    await card
      .locator('.assess-menu-wrap:has(' + sel + ') [data-action="toggleCardMenu"]')
      .first()
      .click();
  }
  return item;
}
