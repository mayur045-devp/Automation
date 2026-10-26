import { GraphQLClient } from 'graphql-request'

const GRAPHQL_URL = import.meta.env.VITE_STRAPI_GRAPHQL_URL || 'http://localhost:1337/graphql'
const TOKEN = import.meta.env.VITE_STRAPI_TOKEN || ''

/**
 * GraphQL client for Strapi.
 * If your Strapi content-type is NOT public, set VITE_STRAPI_TOKEN in .env
 */
export const client = new GraphQLClient(GRAPHQL_URL, {
  headers: TOKEN
    ? { Authorization: `Bearer ${TOKEN}` }
    : {},
})

/**
 * Generic query executor with error handling
 * @param {string} query - GraphQL query string
 * @param {object} variables - Query variables
 */
export async function gqlQuery(query, variables = {}) {
  try {
    const data = await client.request(query, variables)
    return { data, error: null }
  } catch (err) {
    console.error('[GraphQL Error]', err)
    const message =
      err?.response?.errors?.[0]?.message ||
      err?.message ||
      'Unknown GraphQL error'
    return { data: null, error: message }
  }
}
