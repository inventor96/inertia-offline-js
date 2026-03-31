/**
 * DOM utilities for offline template handling.
 * Provides functions to parse HTML and manipulate Inertia page data attributes.
 * 
 * Note: Service workers don't have access to DOMParser or DOM APIs.
 * This module uses string-based manipulation for compatibility with SW context.
 */

import { logDebug, logWarn } from './utils.js';

/**
 * Finds the first occurrence of data-page attribute in HTML string.
 * Uses regex to locate and validate the element exists.
 * @param html - The HTML string to search
 * @returns Object with element found flag and the start/end positions, or null if not found
 */
export function findDataPageAttribute(html: string): { found: boolean; startPos: number; endPos: number } | null {
	try {
		// Match data-page="..." or data-page='...' in HTML
		// This regex finds the opening of the data-page attribute
		const match = html.match(/data-page\s*=\s*["']/);
		if (!match || !match.index) {
			return null;
		}

		const attrStart = match.index;
		const quoteChar = html[match.index + match[0].length - 1]; // Get the quote character used

		// Find the closing quote
		let pos = match.index + match[0].length;
		let endPos = -1;

		while (pos < html.length) {
			if (html[pos] === quoteChar && html[pos - 1] !== '\\') {
				endPos = pos;
				break;
			}
			pos++;
		}

		if (endPos === -1) {
			logWarn('findDataPageAttribute: could not find closing quote');
			return null;
		}

		return {
			found: true,
			startPos: match.index + match[0].length,
			endPos: endPos,
		};
	} catch (err) {
		logWarn('findDataPageAttribute failed', err);
		return null;
	}
}

/**
 * Validates that a data-page attribute exists and only one instance is present.
 * @param html - The HTML string to validate
 * @returns True if exactly one data-page attribute exists, false otherwise
 */
export function validateSingleDataPageAttribute(html: string): boolean {
	try {
		const matches = html.match(/data-page\s*=\s*["']/g);
		if (!matches) {
			logWarn('validateSingleDataPageAttribute: no data-page attribute found');
			return false;
		}

		if (matches.length !== 1) {
			logWarn('validateSingleDataPageAttribute: found multiple data-page attributes', {
				count: matches.length,
			});
			return false;
		}

		return true;
	} catch (err) {
		logWarn('validateSingleDataPageAttribute failed', err);
		return false;
	}
}

/**
 * Clears the data-page attribute value, setting it to an empty string.
 * Used during template caching to store a clean template without page data.
 * @param templateHtml - The HTML template string
 * @returns Modified HTML string with empty data-page attribute, or null if clearing fails
 */
export function clearDataPageAttribute(templateHtml: string): string | null {
	if (typeof templateHtml !== 'string') {
		logWarn('clearDataPageAttribute: template is not a string');
		return null;
	}

	try {
		// Validate exactly one data-page attribute exists
		if (!validateSingleDataPageAttribute(templateHtml)) {
			return null;
		}

		// Find the data-page attribute positions
		const positions = findDataPageAttribute(templateHtml);
		if (!positions) {
			logWarn('clearDataPageAttribute: could not find data-page attribute');
			return null;
		}

		// Build the modified HTML by replacing the attribute value with empty string
		const before = templateHtml.substring(0, positions.startPos);
		const after = templateHtml.substring(positions.endPos);

		return before + after;
	} catch (err) {
		logWarn('clearDataPageAttribute failed', err);
		return null;
	}
}

/**
 * Injects page JSON data into the data-page attribute using string manipulation.
 * This works in service worker contexts where DOMParser is unavailable.
 * @param templateHtml - The HTML template string
 * @param pageData - The Inertia page data object to inject
 * @returns Modified HTML string, or null if injection fails
 */
export function injectPageDataToElement(
	templateHtml: string,
	pageData: Record<string, any>,
): string | null {
	if (typeof templateHtml !== 'string') {
		logWarn('injectPageDataToElement: template is not a string');
		return null;
	}

	try {
		// Validate exactly one data-page attribute exists
		if (!validateSingleDataPageAttribute(templateHtml)) {
			return null;
		}

		// Find the data-page attribute positions
		const positions = findDataPageAttribute(templateHtml);
		if (!positions) {
			logWarn('injectPageDataToElement: could not find data-page attribute');
			return null;
		}

		// Serialize page data to JSON and escape for safe HTML attribute inclusion
		const pageJson = JSON.stringify(pageData);
		const escapedPageJson = escapeHtmlAttribute(pageJson);

		// Build the modified HTML by replacing the attribute value
		const before = templateHtml.substring(0, positions.startPos);
		const after = templateHtml.substring(positions.endPos);

		return before + escapedPageJson + after;
	} catch (err) {
		logWarn('injectPageDataToElement failed', err);
		return null;
	}
}

/**
 * Escapes special characters in a string for safe use in HTML attributes.
 * Used when manually constructing HTML attributes.
 * @param value - The string to escape
 * @returns The escaped string safe for HTML attributes
 */
export function escapeHtmlAttribute(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/"/g, '&quot;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/'/g, '&#39;');
}
