# Vendored spreadsheet dependency

`xlsx-0.20.3.tgz` is SheetJS Community Edition 0.20.3, sourced from the official SheetJS CDN:

`https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz`

SHA-256: `8DC73FC3B00203E72D176E85B50938627C7B086E607C682E8D3C22C02BB99FE8`

The frontend pins this tarball with a local file dependency because the npm registry's `xlsx` package is outdated. Keep the tarball checked in so `npm ci` can reproduce the install. When upgrading, use a release from the official CDN and update both the file reference and this checksum.
