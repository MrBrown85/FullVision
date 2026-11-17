/**
 * The Assignments card's header keeps its actions in its ⋯ menu (the
 * AssignmentsPage board): Class Results, Print, Work Wall, Grade by,
 * Checklists, Set Everyone To › (a submenu), Edit Assessment, Duplicate,
 * Copy to Another Class…, Delete…. `cardMenuItem` opens the menu (and submenu)
 * that holds the action and returns its item, ready to click.
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
  // A level of Set Everyone To sits in the menu's submenu.
  if (!(await item.isVisible())) {
    const sub = card.locator('.assess-setto:has(' + sel + ') [data-action="openCardSubmenu"]').first();
    if (await sub.count()) await sub.click();
  }
  return item;
}
