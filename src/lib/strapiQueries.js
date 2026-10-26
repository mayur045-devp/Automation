import { gqlQuery } from './graphql.js'

/**
 * Introspect the Strapi GraphQL schema to discover all available query fields.
 */
export const INTROSPECTION_QUERY = `
  query IntrospectSchema {
    __schema {
      queryType {
        fields {
          name
          description
          type {
            name
            kind
          }
        }
      }
    }
  }
`

export async function fetchStrapiSchema() {
  return gqlQuery(INTROSPECTION_QUERY)
}

/**
 * Dynamically build and run a query for a given Strapi collection.
 * 
 * @param {string} collectionName - e.g. "articles"
 * @param {string[]} fields - e.g. ["Title"]
 */
export async function fetchCollection(collectionName, fields = []) {
  // Base fields that exist on all Strapi 5 content-types
  const allFields = ['documentId', ...fields]
  // Remove duplicates
  const uniqueFields = Array.from(new Set(allFields))
  const fieldList = uniqueFields.join('\n      ')

  const query = `
    query Fetch_${collectionName} {
      ${collectionName} {
        ${fieldList}
      }
    }
  `
  return gqlQuery(query)
}

export const PING_QUERY = `
  query Ping {
    __typename
  }
`

export async function pingStrapi() {
  return gqlQuery(PING_QUERY)
}
