/**
 * How many of the newest messages per account and folder MiniMail lists. Every view asks for
 * the same window (folder lists, the Dashboard, the copy kept on disk), so whatever one of them
 * shows, the others have too: a message the Dashboard counts can always be found in its folder.
 */
export const MAIL_WINDOW = 500;

/**
 * A smaller first page for a folder that has never been listed on this computer, so the list
 * appears before the whole window has downloaded. The full window follows right after.
 */
export const FIRST_PAGE = 100;
