<!--
SPDX-License-Identifier: Apache-2.0
Copyright 2025 Fernando Rijo Cedeno
-->

# CICS CMCI Mock Server

A local Node.js server for developing and testing CICS clients without a mainframe. It provides CMCI XML responses, Basic/OTP authentication, mock LtpaToken2 cookies, retained result sets, pagination, sorting, and error scenarios.

## Start and test

Requires Node.js 22 or later and an npm registry configured in your environment.

```sh
npm ci
npm start                    # http://127.0.0.1:9080
npm run dev                  # Node's built-in file watcher
npm test                     # automated unit and real HTTP tests
npm run test:coverage        # enforces coverage thresholds
npm run validate             # syntax, license headers, tests, coverage
```

The lockfile keeps exact versions and integrity hashes without registry URLs. Installs use your npm configuration. When updating dependencies, use `npm install --omit-lockfile-registry-resolved` to preserve this format.

CI runs validation on Node.js 22 and 24. Tests create isolated servers on ephemeral ports, require no running server or mainframe, and advance an injected clock to check expiry without waiting.

## Quick examples

### Admin login and cookie reuse

```sh
curl -u adminusr:adminpas -c /tmp/cmci-cookies \
  'http://127.0.0.1:9080/CICSSystemManagement/CICSProgram?count=20'

curl -b /tmp/cmci-cookies \
  'http://127.0.0.1:9080/CICSSystemManagement/CICSManagedRegion'
```

`adminusr` / `adminpas` are static mock credentials. `testuser` uses an OTP instead of a static password:

```sh
curl -X POST 'http://127.0.0.1:9080/auth/generate-otp' \
  -H 'Content-Type: application/json' -d '{"username":"testuser"}'

# Replace 123456 with the returned OTP.
curl -u testuser:123456 -c /tmp/cmci-testuser-cookies \
  'http://127.0.0.1:9080/CICSSystemManagement/CICSProgram'
```

OTPs expire after five minutes and are consumed after one successful login. Generating another OTP before using the current one returns the existing OTP and its remaining lifetime. Use the returned cookie, or an `LtpaToken2` header, for subsequent requests. Set `OTP_SINGLE_USE=false` only when a test needs reusable OTPs.

Sessions expire eight hours after login. Repeated Basic authentication reuses the same live session for a user; header and cookie authentication enforce the same expiry. Session expiry also removes its tokens and retained results. These are mock tokens, not IBM-signed LTPA tokens.

### Retained results and pagination

```sh
# The resultsummary contains the cachetoken to use below.
curl -u adminusr:adminpas \
  'http://127.0.0.1:9080/CICSSystemManagement/CICSProgram?count=20&NODISCARD&SUMMONLY'

# Replace TOKEN with that cachetoken; indices are 1-based.
curl -u adminusr:adminpas \
  'http://127.0.0.1:9080/CICSSystemManagement/CICSResultCache/TOKEN/6/5?NODISCARD'

# Release the snapshot when finished.
curl -u adminusr:adminpas \
  'http://127.0.0.1:9080/CICSSystemManagement/CICSResultCache/TOKEN?SUMMONLY'
```

Retained results follow the [IBM cache lifecycle](https://www.ibm.com/docs/en/cics-ts/6.x?topic=cgr-using-retained-result-sets-improve-performance-get-requests): reads with `NODISCARD` keep the snapshot; reads without it discard the snapshot. `SUMMONLY` omits records and reports zero displayed records while preserving the total count. Successful retained reads renew the fifteen-minute idle deadline. Concurrent readers should all specify `NODISCARD`.

The mock additionally retains initial GET results automatically by default. Set `AUTO_CACHE=false` to require `NODISCARD` or `cache=true` for initial retention.

Unknown or expired `/CICSResultCache/TOKEN` requests return HTTP 404. The legacy query form, `CICSProgram?cachetoken=TOKEN&index=6&count=5`, shares pagination, sorting, ownership, and discard behavior. For compatibility, an unknown query token generates fresh data with a new token. Set `CACHE_MISS_FALLBACK=false` to make query misses return 404 too. A query token cannot be used for a different resource or context.

Results belong to the creating user's session; another authenticated user gets HTTP 403. Repeated equivalent GETs return the same token and records. Requests in different CICS contexts or scopes have separate cache identities. Storage evicts the least recently used snapshots when configured limits are reached.

### Sorting and errors

```sh
curl -u adminusr:adminpas \
  'http://127.0.0.1:9080/CICSSystemManagement/CICSProgram?count=10&ORDERBY=status,program/D'

curl -u adminusr:adminpas \
  'http://127.0.0.1:9080/CICSSystemManagement/CICSProgram?simulate=nodata'
```

`ORDERBY` accepts up to 32 comma-separated attribute names, case-insensitively, with optional `/A` or `/D` directions. Sorting compares XML attribute values lexicographically, occurs before pagination, and preserves the stored snapshot's order.

| Parameter | Behavior |
| --- | --- |
| `count=N` | Generate N records on an initial GET (default 3, maximum 10,000); page size on a cache read |
| `index=N` | First displayed record, starting at 1 |
| `NODISCARD` | Create or keep a retained result set; presence enables it |
| `SUMMONLY` | Return only the summary; presence enables it |
| `ORDERBY=field1,field2/D` | Sort before pagination |
| `cachetoken=TOKEN` | Read a retained result via the resource query |
| `cache=true` | Mark a retained snapshot for legacy cache monitoring/cleanup |
| `simulate=NAME` | Return a selected CMCI response code |

Parameter names are case-insensitive. Duplicate parameters, invalid integers, negative counts, zero cache page sizes, and invalid sort expressions return HTTP 400 with a CMCI `INVALIDPARM` response. An initial `count=0` returns `NODATA` without allocating a cache entry.

| Simulation | CMCI code |
| --- | --- |
| `ok` | 1024 |
| `nodata` | 1027 |
| `invalidparm` | 1028 |
| `notavailable` | 1034 |
| `invaliddata` | 1041 |

Simulations intentionally return HTTP 200 with the selected CMCI code, allowing tests of client-side CMCI error handling separately from HTTP failures. Actual invalid input, missing resources, authentication failures, and cache access violations use appropriate HTTP error statuses.

### Write operations

```sh
curl -u adminusr:adminpas -X POST \
  'http://127.0.0.1:9080/CICSSystemManagement/CICSDefinitionProgram' \
  -H 'Content-Type: application/xml' \
  -d '<request><create><parameter name="CSD"><cicsdefinitionprogram program="MYPROG"/></parameter></create></request>'
```

Resource POST, PUT, and DELETE return operation acknowledgements. **They do not persist resource changes.** POST requires a well-formed XML document with one `request` root. PUT validates XML when a body is provided and permits an empty operation request. `application/xml`, `text/xml`, and `application/*+xml` are accepted. Invalid documents, trailing garbage, extra roots, and DTD/entity declarations are rejected. Unsupported content types return 415; oversized bodies return 413. `DELETE /CICSSystemManagement/CICSResultCache/TOKEN` actually deletes the retained set.

### Run the CICS client system tests

The optional stateful mode supports the existing SDK and CLI system tests in [zowe/cics-for-zowe-client](https://github.com/zowe/cics-for-zowe-client). No client source or connection configuration changes are required.

Install dependencies in both checkouts first. For CLI tests, install Zowe CLI and build the SDK and CLI using the client's existing package scripts:

```sh
cd ~/gh/zowe/cics/packages/sdk
npm run build
cd ../cli
npm run build
```

From this mock-server project:

```sh
# Defaults to ~/gh/zowe/cics and runs both SDK and CLI suites.
npm run test:client

# Select a different checkout or run only the SDK suite.
npm run test:client -- --client ~/gh/zowe/cics --package sdk

# Forward Jest options after a second --, for example a quick retrieval check.
npm run test:client -- --package sdk -- --runTestsByPath __tests__/__system__/get/Get.resource.system.test.ts
```

The runner starts an isolated stateful server on an available loopback port, supplies `adminusr` / `adminpas`, `REGION1`, and `MOCKGRP` via a temporary properties file, and invokes `npm run test:system` from each selected client package. It uses the test utilities' `propdirectory` and `propfile` environment overrides, leaving any existing `custom_properties.yaml` untouched. The server and properties file are removed when the run finishes or is interrupted. Failures propagate as a nonzero exit status. The client's tests still create their usual ignored reports and isolated CLI plugin installations.

These suites include deliberate delays for real CICS; allow several minutes. CLI help snapshots depend on the installed Zowe CLI version. For example, a newer CLI's `--cert-account` option can cause help snapshot failures independently of the mock. The runner does not update snapshots or suppress those failures. The current client also has a focused `fit` in its GET CLI suite, which causes its two other GET tests to be skipped by Jest.

For a targeted CLI operation check that explicitly excludes help snapshots:

```sh
npm run test:client -- --package cli -- --testNamePattern 'successfully|with basic options|with profile options'
```

To run the server manually in stateful mode:

```sh
STATEFUL=true npm start
```

Use this connection configuration in an external properties file when invoking the client's package tests yourself:

```yaml
cics:
  user: adminusr
  password: adminpas
  host: 127.0.0.1
  port: 9080
  protocol: http
  rejectUnauthorized: false
cmci:
  regionName: REGION1
  csdGroup: MOCKGRP
urimap:
  certificate: " "
```

Stateful mode keeps definitions and installed resources separately. It implements definition creation/deletion, duplicate feedback (`TABLEERROR` with `DUPRES`), `CSDINSTALL`, installed-resource deletion, attribute updates such as URI-map `ENABLESTATUS`, program `NEWCOPY`/`PHASEIN`, and CSD group list membership. `DFHBRCV` is seeded as an installed program. New definitions are visible in subsequent GETs; existing retained result sets remain snapshots. State belongs to the app instance and resets on restart. Each resource table in each configured region is bounded by `MAX_RECORDS`.

Supported `CRITERIA` syntax is `field=value` or `field==value`, optionally quoted, with `*` wildcards, parentheses, and `AND` conjunctions. Fields and values are matched case-insensitively. `PARAMETER=CSDGROUP(group)` filters definitions. Unsupported expressions/actions fail explicitly. Unknown regions return CMCI `INVALIDPARM`; unmatched queries or mutations return `NODATA`. `REGIONS=REGION1,REGION2` configures allowed regions; `CSD_GROUP=GROUP1` configures the seeded CSD group. Context/scope paths select the final region; this mode does not implement plex membership or aggregation, full IBM schema validation, load-library behavior, or persistent storage. Supplied fixtures seed each region's tables. Default mode retains its original generated records and stateless acknowledgements.

## Custom fixtures and embedded use

```js
const { createApp } = require('./server');

const app = createApp({
  config: { autoCache: false, cacheMissFallback: false },
  fixtures: {
    CICSProgram: [
      { program: 'PAYROLL', status: 'ENABLED', language: 'COBOL' },
      { program: 'REPORT', status: 'DISABLED', language: 'COBOL' }
    ]
  }
});

const server = app.listen(0, '127.0.0.1');
// Close server when your client tests finish.
```

Each `createApp()` has independent sessions, OTPs, and cached results. Importing `server.js` starts no listener or cleanup interval. The existing default Express app export is preserved. Embedded apps use stable defaults; pass `env: process.env` explicitly to read environment settings. `now: () => milliseconds` supports deterministic expiry tests, and `logger` can receive unexpected server errors.

Fixtures are cloned on creation and use plain attribute objects with scalar values. An initial GET returns all supplied fixture records unless `count` caps them. Empty fixtures return `NODATA`. Generated records and default fixture keys have deterministic hexadecimal `_keydata` values.

## Supported resources and current limits

See `RESOURCE_TYPES` in [src/resources.js](src/resources.js) for the complete list, including programs, definitions, transactions, regions, plexes, bundles, files, URI maps, libraries, pipelines, JVM servers and endpoints, temporary storage queues, CSD groups, tasks, and retained results. All 17 names in the [Zowe client resource enum](https://github.com/zowe/cics-for-zowe-client/blob/main/packages/vsce-api/src/resources/ResourceTypes.ts) have endpoints. Unknown resource names return 404.

Programs, managed regions, plexes, remote files, JVM endpoints, and both temporary storage queue types have dedicated templates. Other types have generic `name`/`status` records unless you supply fixtures. The following templates provide the fields required by the corresponding Zowe resource interfaces:

| Resource | Representative attributes |
| --- | --- |
| [CICSRemoteFile](https://www.ibm.com/docs/en/cics-ts/6.x?topic=tables-remfile-resource-table) | `file`, `remotename`, `remotesystem`, `enablestatus` |
| [CICSJVMEndpoint](https://www.ibm.com/docs/en/cics-ts/6.x?topic=tables-endpoint-resource-table) | `jvmendpoint`, `jvmserver`, `host`, `port`, `secport`, `enablestatus`, `type` |
| [CICSTSQueue](https://www.ibm.com/docs/en/cics-ts/6.x?topic=tables-tsqname-resource-table) | `name`, `hexname`, `location`, `numitems`, `quelength`, `expiryint`, `transid`, `tsmodel` |
| [CICSSharedTSQueue](https://www.ibm.com/docs/en/cics-ts/5.5.0?topic=tables-tsqshr-resource-table) | `name`, `poolname`, `hexname`, `location`, `numitems`, `quelength` |

These four templates include `eyu_cicsname="REGION1"` and deterministic identities. JVM endpoints include both identity fields, `jvmendpoint` and `jvmserver`; shared queues include `name` and `poolname`. Queue `hexname` values encode the 16-byte, space-padded EBCDIC name. They support the same authentication, fixtures, sorting, retained-result pagination, and stateless write acknowledgements as the other resource endpoints.

In default mode, context/scope path segments separate cache identity without filtering generated records, and writes remain stateless. Enable the optional stateful mode above for region validation, criteria filtering, and the supported resource operations. Full IBM schema validation and the CMCI schema endpoint are not implemented. SDK/extension integration should verify the fields it consumes with custom fixtures.

## Administrative endpoints

All `/admin/*` endpoints require `adminusr` credentials or its current LtpaToken2. Health and OTP generation/status endpoints are public mock controls.

```sh
curl -u adminusr:adminpas 'http://127.0.0.1:9080/admin/retained-results'
curl -u adminusr:adminpas -X DELETE 'http://127.0.0.1:9080/admin/retained-results'
```

| Path | GET | DELETE |
| --- | --- | --- |
| `/health` | Health, live session/token/cache counts, retained record count | — |
| `/admin/sessions` | Sessions and token metadata | Sessions, their tokens, and results |
| `/admin/ltpa-tokens` | Current tokens | Revoke tokens; subsequent Basic login issues a new token |
| `/admin/cache` | Tokens marked `cache=true` | Those snapshots only |
| `/admin/retained-results` | All snapshots and metadata | All snapshots |
| `/admin/retained-results/:token` | — | One snapshot, or 404 |
| `/admin/otps` | OTP expiry metadata, without OTP values | Active OTPs |
| `/auth/generate-otp` | — | —; POST JSON `{ "username": "testuser" }` |
| `/auth/otp-status/testuser` | OTP presence and remaining lifetime | — |

Reading an admin endpoint with Basic credentials creates or renews the admin's authentication mapping. Use `/health` to check that session/token cleanup left zero entries without creating another session. Expired state is removed on requests, without background timers. No credentials or request headers are written to server logs.

## Configuration

### Request logging

Set `LOG_REQUESTS=true` to print one line for every completed HTTP response:

```sh
LOG_REQUESTS=true STATEFUL=true PORT=9080 npm start
```

Example output:

```text
GET /CICSSystemManagement/CICSProgram/REGION1?CRITERIA=(PROGRAM=D*) -> 200 (2.4 ms)
POST /CICSSystemManagement/CICSDefinitionProgram/REGION1 -> 200 (1.1 ms)
GET /missing -> 404 (0.3 ms)
```

Each line includes the method, request path and query, HTTP status, and elapsed time. Logging includes authentication failures, malformed bodies, missing routes, and CORS preflight responses. Headers and bodies are omitted; query parameters containing password, token, OTP, cookie, authorization, secret, or credential names are redacted. Request logging is disabled by default.

The client test runner supports the same setting:

```sh
LOG_REQUESTS=true npm run test:client -- --package sdk
```

For embedded use, pass `config: { logRequests: true }` to `createApp()`. Messages use `console.log` by default or the supplied `logger.log` method.

### Server settings

`npm start` and `npm run dev` read these environment variables. Programmatic `config` keys use camelCase, as shown below.

| Environment | Config key | Default |
| --- | --- | --- |
| `HOST` | `host` | `127.0.0.1` |
| `PORT` | `port` | `9080` (`0` selects an ephemeral port) |
| `DEFAULT_COUNT` | `defaultCount` | `3` |
| `MAX_RECORDS` | `maxRecords` | `10000` |
| `MAX_RESULT_SETS` | `maxResultSets` | `100` |
| `MAX_CACHED_RECORDS` | `maxCachedRecords` | `100000` |
| `CACHE_TTL_MS` | `cacheTtlMs` | `900000` |
| `SESSION_TTL_MS` | `sessionTtlMs` | `28800000` |
| `OTP_TTL_MS` | `otpTtlMs` | `300000` |
| `OTP_SINGLE_USE` | `otpSingleUse` | `true` |
| `AUTO_CACHE` | `autoCache` | `true` |
| `CACHE_MISS_FALLBACK` | `cacheMissFallback` | `true` |
| `BODY_LIMIT` | `bodyLimit` | `100kb` |
| `STATEFUL` | `stateful` | `false` |
| `REGIONS` | `regions` | `REGION1` (comma-separated names) |
| `CSD_GROUP` | `csdGroup` | `MOCKGRP` |
| `LOG_REQUESTS` | `logRequests` | `false` |

Boolean environment values must be `true` or `false`. Numeric configuration is validated before startup; `DEFAULT_COUNT <= MAX_RECORDS <= MAX_CACHED_RECORDS`. Limits cap retained record counts, not exact bytes. Increase them deliberately for larger client datasets. Use `HOST=0.0.0.0` when a container or another machine needs access.

## Examples and development

With the server running:

```sh
node examples/test-client.js
node examples/retained-result-sets-demo.js
bash examples/otp-workflow-demo.sh        # requires curl and jq
bash examples/token-management-demo.sh   # requires curl and jq
```

Examples accept `MOCK_SERVER_URL` (default `http://127.0.0.1:9080`). They exercise and sometimes clear mock state; automated tests use their own isolated instances.

Code is split into configuration (`src/config.js`), CMCI XML/query utilities (`src/cmci.js`), resource templates (`src/resources.js`), authentication (`src/auth.js`), session/cache storage (`src/state.js`), routes (`src/cmci-routes.js`, `src/admin-routes.js`), and app assembly (`src/app.js`). `server.js` owns startup and shutdown.

The test suite covers every listed resource, malformed requests, authentication and OTP races, session/token expiry and revocation, cache ownership/expiry/discard, concurrent pagination, stable snapshots, sorting, fixtures, memory limits, administrative cleanup, module imports, and CLI lifecycle. Coverage checks require 95% lines, 85% branches, and 95% functions across server code.

`npm run license:check` now fails if source headers are missing; `npm run license:add` adds them. `npm audit` uses the configured registry.

## Next improvements, in priority order

1. **More SDK contract tests.** `npm run test:client` runs the existing SDK/CLI system suites. Add retained pagination and authentication flows through `CicsCmciRestClient` to broaden client coverage.
2. **Representative resource fixtures.** Add sanitized, versioned IBM response fixtures for the attributes the extension uses. Verify required fields for each resource instead of relying on generic records.
3. **Broader stateful operations and filtering.** Extend the optional stateful mode with additional actions, criteria operators, and plex membership/aggregation.
4. **Scripted failure scenarios.** Add per-instance sequences for latency, transport failures, and HTTP errors so clients can test retries, cancellation, and recovery reproducibly.

## Compatibility changes

Node.js 22+ is required; Express 5 replaces Express 4. The CLI binds to loopback by default. Admin endpoints require admin authentication. OTPs are now single-use with the documented five-minute lifetime. Invalid inputs and unknown resources fail explicitly. Cache path misses no longer fabricate data, and displayed counts match the records actually sent. Existing initial automatic caching and legacy query miss fallback remain enabled by default.

## License

Apache-2.0; see [LICENSE](LICENSE).
