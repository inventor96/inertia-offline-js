/**
 * DOM utilities for offline template handling.
 * Provides functions to parse HTML and manipulate Inertia page data attributes.
 * 
 * Note: Service workers don't have access to DOMParser or DOM APIs.
 * This module uses string-based manipulation for compatibility with SW context.
 */

import { logDebug, logWarn } from './utils.js';
import { OFFLINE_TEMPLATE_ELEMENT_SELECTOR } from './constants.js';
import type { TemplatePageDataSource } from './constants.js';

interface SelectorSpec {
	tagName: 'any' | 'script';
	dataPageValue: string | null;
}

interface PositionRange {
	startPos: number;
	endPos: number;
}

interface ResolvedTarget {
	source: Exclude<TemplatePageDataSource, 'auto'>;
	range: PositionRange;
}

/**
 * Parses the element selector to determine the type of target and any specific
 * data-page value. Supports selectors like '[data-page]',
 * '[data-page="value"]', 'script[data-page]', 'script[data-page="value"]'.
 * @param selector - The CSS selector string to parse
 * @returns An object describing the tag type and expected data-page value, or
 *     defaults if parsing fails
 */
function parseSelector(selector: string): SelectorSpec {
	const normalized = selector.trim();
	const match = normalized.match(/^(script\s*)?\[\s*data-page(?:\s*=\s*["']([^"']+)["'])?\s*\]$/i);
	if (!match) {
		logWarn('Unsupported templateElementSelector; falling back to [data-page]', { selector });
		return { tagName: 'any', dataPageValue: null };
	}

	return {
		tagName: match[1] ? 'script' : 'any',
		dataPageValue: typeof match[2] === 'string' ? match[2] : null,
	};
}

/**
 * Finds all matches of data-page attributes in the HTML string based on the
 * provided selector. Returns an array of position ranges for each match.
 * @param html - The HTML string to search
 * @param selector - The CSS selector defining the target elements
 * @returns An array of position ranges where data-page attributes are found
 */
function findDataPageAttributeMatches(html: string, selector: string): PositionRange[] {
	const spec = parseSelector(selector);
	const matches: PositionRange[] = [];
	const tagRegex = /<([a-zA-Z][\w:-]*)\b[^>]*>/g;
	let tagMatch: RegExpExecArray | null = null;

	while ((tagMatch = tagRegex.exec(html)) !== null) {
		const tagName = (tagMatch[1] || '').toLowerCase();

		// Scripts are handled separately in findScriptDataPageMatches, so skip them here
		if (tagName === 'script') {
			continue;
		}

		// Selector requires a script tag, but this is not a script tag, so skip
		if (spec.tagName === 'script') {
			continue;
		}

		// Check if this tag has the data-page attribute
		const openingTag = tagMatch[0];
		const attrMatch = openingTag.match(/\bdata-page\s*=\s*(["'])([\s\S]*?)\1/i);
		if (!attrMatch) {
			continue;
		}

		// If a specific data-page value is expected, ensure it matches
		if (spec.dataPageValue !== null && attrMatch[2] !== spec.dataPageValue) {
			continue;
		}

		// Calculate the position of the attribute value in the original HTML string
		const valueOffset = attrMatch.index! + attrMatch[0].indexOf(attrMatch[2]);

		// Store the start and end positions of the attribute value
		matches.push({
			startPos: tagMatch.index + valueOffset,
			endPos: tagMatch.index + valueOffset + attrMatch[2].length,
		});
	}

	return matches;
}

/**
 * Determines if a script tag has a type attribute indicating JSON content.
 * This is used to identify script tags that contain Inertia page data.
 * @param openingTag - The full opening tag string to analyze
 * @returns True if the tag is a JSON script tag, false otherwise
 */
function isJsonScriptTag(openingTag: string): boolean {
	// Check for type attribute
	const typeMatch = openingTag.match(/\btype\s*=\s*(["'])(.*?)\1/i);
	if (!typeMatch) {
		return false;
	}

	// Consider it a JSON script if the type is application/json
	return typeMatch[2].trim().toLowerCase().startsWith('application/json');
}

/**
 * Finds all script tags with data-page attributes in the HTML string based on
 * the provided selector. Returns an array of position ranges for the content
 * of each matching script tag.
 * @param html - The HTML string to search
 * @param selector - The CSS selector defining the target script elements
 * @returns An array of position ranges where script data-page content is found
 */
function findScriptDataPageMatches(html: string, selector: string): PositionRange[] {
	const spec = parseSelector(selector);
	const matches: PositionRange[] = [];
	const openScriptRegex = /<script\b[^>]*>/gi;
	let openMatch: RegExpExecArray | null = null;

	while ((openMatch = openScriptRegex.exec(html)) !== null) {
		// If selector requires a non-script tag, skip all script tags
		if (spec.tagName !== 'any' && spec.tagName !== 'script') {
			continue;
		}

		// Check if this script tag has the data-page attribute
		const openingTag = openMatch[0];
		const dataPageMatch = openingTag.match(/\bdata-page(?:\s*=\s*(["'])(.*?)\1)?/i);
		if (!dataPageMatch) {
			continue;
		}

		// If a specific data-page value is expected, ensure it matches
		if (spec.dataPageValue !== null && dataPageMatch[2] !== spec.dataPageValue) {
			continue;
		}

		// Ensure this script tag is a JSON type
		if (!isJsonScriptTag(openingTag)) {
			continue;
		}

		// Calculate the position of the script content in the original HTML string
		const contentStart = openMatch.index + openingTag.length;
		const closeIdx = html.indexOf('</script>', contentStart);
		if (closeIdx === -1) {
			logWarn('findScriptDataPageMatches: script data-page tag missing closing tag');
			continue;
		}

		// Store the start and end positions of the script content
		matches.push({
			startPos: contentStart,
			endPos: closeIdx,
		});
	}

	return matches;
}

/**
 * Resolves the target position for data-page content based on the selector and
 * source mode. Handles 'auto' mode by trying script first, then attribute if
 * no script matches.
 * @param html - The HTML string to search
 * @param source - The source mode ('script', 'attribute', or 'auto')
 * @param selector - The CSS selector defining the target elements
 * @param context - The context for logging purposes
 * @returns The resolved target or null if not found
 */
function resolveTarget(
	html: string,
	source: TemplatePageDataSource,
	selector: string,
	context: string,
): ResolvedTarget | null {
	// Handle explicit script source mode
	if (source === 'script') {
		const scriptMatches = findScriptDataPageMatches(html, selector);
		if (scriptMatches.length !== 1) {
			logWarn(`${context}: expected exactly one script data-page target`, { count: scriptMatches.length, selector });
			return null;
		}
		return { source: 'script', range: scriptMatches[0] };
	}

	// Handle explicit attribute source mode
	if (source === 'attribute') {
		const attrMatches = findDataPageAttributeMatches(html, selector);
		if (attrMatches.length !== 1) {
			logWarn(`${context}: expected exactly one attribute data-page target`, { count: attrMatches.length, selector });
			return null;
		}
		return { source: 'attribute', range: attrMatches[0] };
	}

	// Handle auto source mode - script
	const scriptMatches = findScriptDataPageMatches(html, selector);
	if (scriptMatches.length > 1) {
		// They seem to be trying to use script tags, but there are multiple matches
		logWarn(`${context}: found multiple script data-page targets`, { count: scriptMatches.length, selector });
		return null;
	}
	if (scriptMatches.length === 1) {
		// Found exactly one script match, so we'll use that
		logDebug(`${context}: auto mode selected script data-page target`, { selector });
		return { source: 'script', range: scriptMatches[0] };
	}

	// Handle auto source mode - attribute
	const attrMatches = findDataPageAttributeMatches(html, selector);
	if (attrMatches.length !== 1) {
		// Zero or multiple attribute matches is a problem
		logWarn(`${context}: expected exactly one attribute data-page target in auto mode`, { count: attrMatches.length, selector });
		return null;
	}

	// Found exactly one attribute match, so we'll use that
	logDebug(`${context}: auto mode selected attribute data-page target`, { selector });
	return { source: 'attribute', range: attrMatches[0] };
}

/**
 * Finds the first occurrence of data-page attribute in HTML string.
 * Uses regex to locate and validate the element exists.
 * @param html - The HTML string to search
 * @param elementSelector - The CSS selector defining the target element
 * @returns Object with element found flag and the start/end positions, or null if not found
 */
export function findDataPageAttribute(
	html: string,
	elementSelector: string = OFFLINE_TEMPLATE_ELEMENT_SELECTOR,
): { found: boolean; startPos: number; endPos: number } | null {
	try {
		// Check for exactly one match of the data-page attribute based on the selector
		const matches = findDataPageAttributeMatches(html, elementSelector);
		if (matches.length !== 1) {
			return null;
		}

		return {
			found: true,
			startPos: matches[0].startPos,
			endPos: matches[0].endPos,
		};
	} catch (err) {
		logWarn('findDataPageAttribute failed', err);
		return null;
	}
}

/**
 * Validates that a data-page attribute exists and only one instance is present.
 * @param html - The HTML string to validate
 * @param source - The source mode for locating the data-page content
 * @param elementSelector - The CSS selector defining the target element
 * @returns True if exactly one data-page attribute exists, false otherwise
 */
export function validateSingleDataPageAttribute(
	html: string,
	source: TemplatePageDataSource = 'auto',
	elementSelector: string = OFFLINE_TEMPLATE_ELEMENT_SELECTOR,
): boolean {
	try {
		return !!resolveTarget(html, source, elementSelector, 'validateSingleDataPageAttribute');
	} catch (err) {
		logWarn('validateSingleDataPageAttribute failed', err);
		return false;
	}
}

/**
 * Clears the data-page attribute value, setting it to an empty string.
 * Used during template caching to store a clean template without page data.
 * @param templateHtml - The HTML template string
 * @param source - The source mode for locating the data-page content
 * @param elementSelector - The CSS selector defining the target element
 * @returns Modified HTML string with empty data-page attribute, or null if clearing fails
 */
export function clearDataPageAttribute(
	templateHtml: string,
	source: TemplatePageDataSource = 'auto',
	elementSelector: string = OFFLINE_TEMPLATE_ELEMENT_SELECTOR,
): string | null {
	if (typeof templateHtml !== 'string') {
		logWarn('clearDataPageAttribute: template is not a string');
		return null;
	}

	try {
		const target = resolveTarget(templateHtml, source, elementSelector, 'clearDataPageAttribute');
		if (!target) {
			logWarn('clearDataPageAttribute: could not resolve data-page target', {
				source,
				elementSelector,
			});
			return null;
		}

		const before = templateHtml.substring(0, target.range.startPos);
		const after = templateHtml.substring(target.range.endPos);

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
 * @param source - The source mode for locating the data-page content
 * @param elementSelector - The CSS selector defining the target element
 * @returns Modified HTML string, or null if injection fails
 */
export function injectPageDataToElement(
	templateHtml: string,
	pageData: Record<string, any>,
	source: TemplatePageDataSource = 'auto',
	elementSelector: string = OFFLINE_TEMPLATE_ELEMENT_SELECTOR,
): string | null {
	if (typeof templateHtml !== 'string') {
		logWarn('injectPageDataToElement: template is not a string');
		return null;
	}

	try {
		const target = resolveTarget(templateHtml, source, elementSelector, 'injectPageDataToElement');
		if (!target) {
			logWarn('injectPageDataToElement: could not resolve data-page target', {
				source,
				elementSelector,
			});
			return null;
		}

		const pageJson = JSON.stringify(pageData);
		const payload = target.source === 'attribute' ? escapeHtmlAttribute(pageJson) : pageJson;

		const before = templateHtml.substring(0, target.range.startPos);
		const after = templateHtml.substring(target.range.endPos);

		return before + payload + after;
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
