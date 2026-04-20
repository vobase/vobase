/**
 * Server-side branding constants. Reads the same env vars that Vite injects
 * into the frontend bundle (VITE_PRODUCT_NAME, VITE_VENDOR_NAME) so outbound
 * emails and the auth shell agree on product identity.
 */

export const productName = process.env.PRODUCT_NAME ?? process.env.VITE_PRODUCT_NAME ?? 'Vobase'

export const vendorName = process.env.VENDOR_NAME ?? process.env.VITE_VENDOR_NAME ?? 'Vobase'
