import map from 'lodash.map';
import size from 'lodash.size';
import { AirtableDBTable } from '../../types/airtableDataset/AirtableDBTable';
import { AirtableSchema } from '../../types/airtableDataset/AirtableSchema';
import { FieldSchema } from '../../types/airtableDataset/FieldSchema';
import { GenericAirtableRecordsListApiResponse } from '../../types/airtableDataset/GenericAirtableRecordsListApiResponse';
import { RawAirtableRecordsSet } from '../../types/airtableDataset/RawAirtableRecordsSet';
import { TableSchema } from '../../types/airtableDataset/TableSchema';
import fetchAirtableTable from '../api/fetchAirtableTable';

import hybridCache from '../caching/hybridCache';

/**
 * When running on Vercel, wait some time after each API request to avoid running the next API request too fast
 * If we don't do that, we might reach their API rate limit (5 requests per 1 second) and get blocked.
 *
 * XXX Note that you should adapt VERCEL_DISK_CACHE_TTL based on this value.
 *  If the latency between each request is important to you in order to avoid reaching the limit (e.g: 1+ sec between 2 requests),
 *  then depending on how many tables you fetch you should make sure your TTL is high enough to avoid fetching multiple times because TTL has expired.
 *
 * XXX Despite the latency, the requests are executed multiple times anyway, because static pages are generated by batch of 3 pages at a time.
 *  This generates 3 Airtable API requests at the same time, and none of them benefit from the cache because they have the same latency (parallel execution).
 *  This is because Next.js generates pages by batch, so the first batch doesn't benefit from any caching mechanism at all.
 *  All other batches benefit from the cache though. It's still better than no caching,
 *  but it could be reduced even more by pre-fetching the Airtable API even before generating pages, and do only one API request per table.
 */
const FORCED_LATENCY_BETWEEN_AIRTABLE_API_REQUESTS = 2000; // In ms

/**
 * By default, the HybridCache would use 30sec TTL.
 * We override it to make sure all our Airtable API requests are only executed as less often as possible.
 */
const VERCEL_DISK_CACHE_TTL = 180; // In seconds

/**
 * Fetch all tables described in the schema.
 *
 * Promises are executed in parallel to fetch the whole dataset faster, useful when several tables are being fetched.
 * Although, a "preDelay" is applied to make sure not to run all queries at the same time, because of the 5 API request per second Airtable limit.
 *
 * XXX Running with a delay is still faster than running in series, but obviously slower than running all requests in parallel without delaying them.
 *  But there isn't a better way of doing things, as we must not hit the API rate limit or the app will completely crash during the initial build, or when preview mode is enabled.
 *
 * @param airtableSchema
 * @param localesOfLanguagesToFetch Locales/languages (e.g: 'en', 'en_gb') that should be fetched to resolve i18n fields.
 *  There is no point fetching more locales than those that will be used to resolve the best available translation during the Sanitization step.
 *  Whether you use locales or languages is up to you, as it depends how you name your Airtable fields.
 *  Tip: "Underscore" is recommended if using localized locales. (i.e: 'en_gb', not 'en-gb')
 */
export const fetchAirtableDS = async (airtableSchema: AirtableSchema, localesOfLanguagesToFetch: string[]): Promise<RawAirtableRecordsSet[]> => {
  const promises: Promise<any>[] = [];
  const rawAirtableRecordsSets: RawAirtableRecordsSet[] = [];
  const tableSchemaKeys: AirtableDBTable[] = Object.keys(airtableSchema) as AirtableDBTable[];

  for (let i = 0; i < size(tableSchemaKeys); i++) {
    const tableName: AirtableDBTable = tableSchemaKeys[i];
    const tableSchema: TableSchema = airtableSchema[tableName];
    const tableNamePlural: string = tableSchema.plural ? tableSchema.plural : `${tableName}s`;
    const tableCacheKey = `${tableNamePlural}Table`;
    const filterByFormula: string = tableSchema.filterByFormula;
    const allowedFields: string[] = [];
    const preDelay: number = process.env.NODE_ENV !== 'development' ? i * FORCED_LATENCY_BETWEEN_AIRTABLE_API_REQUESTS : 0;

    // Compute the list of allowed fields that'll be returned by the Airtable API
    // Dynamically allow i18n fields (label => labelEN + labelFR) for all locales/languages necessary to build the current page
    map(tableSchema.fields, (fieldSchema: FieldSchema, fieldName: string) => {
      // Virtual fields aren't fetched (they may not exist on Airtable)
      if (!fieldSchema.isVirtual) {
        if (fieldSchema.isI18n) {
          // Fetch translations for all supported locales, not matter how many there are, because we'll need them all to
          map(localesOfLanguagesToFetch, (supportedLang: string) => allowedFields.push(`${fieldName}${supportedLang.toUpperCase()}`));
        } else {
          allowedFields.push(`${fieldName}`);
        }
      }
    });

    // eslint-disable-next-line no-console
    // console.debug(`(Promise) The table ${tableName} will be fetched in ${preDelay}ms.`);

    if (preDelay > (VERCEL_DISK_CACHE_TTL * 1000)) {
      // eslint-disable-next-line no-console
      console.warn(`[WARNING] Your Vercel cache TTL is lower than the Airtable API request delay for ${tableName} (delay: ${preDelay} > ${VERCEL_DISK_CACHE_TTL * 1000}. This will cause your API requests to be sent multiple times and is probably not what you want. You should increase your TTL value.`);
    }

    // Running all promises but don't await for them (we will await them all later to run them in parallel)
    promises.push(
      hybridCache(
        tableCacheKey,
        async () => await fetchAirtableTable(tableName, { fields: allowedFields, filterByFormula }) as GenericAirtableRecordsListApiResponse,
        {
          enabled: !!process.env.IS_SERVER_INITIAL_BUILD && process.env.NODE_ENV !== 'development',
          storage: {
            type: 'disk',
            options: {
              filename: tableCacheKey,
            },
          },
          ttl: VERCEL_DISK_CACHE_TTL,

          // Force the parallel requests to run "in series" when executed on Vercel (but not in development)
          preDelay,
        },
      ),
    );
  }

  // Run all promises in parallel and compute results into the dataset
  const results: GenericAirtableRecordsListApiResponse[] = await Promise.all(promises);
  for (let i = 0; i < size(tableSchemaKeys); i++) {
    const tableName: AirtableDBTable = tableSchemaKeys[i];
    const { records } = results[i] as GenericAirtableRecordsListApiResponse;

    rawAirtableRecordsSets.push({
      records,
      __typename: tableName,
    });
  }

  return rawAirtableRecordsSets;
};

export default fetchAirtableDS;
