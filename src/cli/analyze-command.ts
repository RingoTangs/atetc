import type { Field10Counts, PakAnalysis } from '../pak-analysis'
import fs from 'node:fs'
import { parsePak } from '../pak'
import { analyzePak } from '../pak-analysis'

export interface AnalyzeOptions {
  json?: boolean
}

function field10Counts(value: Field10Counts): string {
  return `zero=${value.zero}, timestamp-like=${value.timestampLike}, non-timestamp-like=${value.nonTimestampLike}`
}

function formatAnalysis(analysis: PakAnalysis): string {
  const lines = [
    `Archive: ${analysis.archive ?? '<memory>'}`,
    `Size: ${analysis.header.fileSize}`,
    `Header: magic=${analysis.header.magicHex}, indexSize=${analysis.header.indexSize}, field08=${analysis.header.field08}, field0c=${analysis.header.field0c}, dataStart=${analysis.header.dataStart}`,
    `Entries: root=${analysis.header.rootEntryCount}, total=${analysis.entryStats.total}, files=${analysis.entryStats.files}, directories=${analysis.entryStats.directories}, maxDepth=${analysis.entryStats.maximumDepth}`,
    'field00:',
    ...analysis.field00Stats.map(
      (item) =>
        `  ${item.hex}: count=${item.count}, files=${item.files}, directories=${item.directories}, stored=${item.storedCount}, payloads=${JSON.stringify(item.payloadKinds)}`,
    ),
    `field10: ${field10Counts(analysis.field10Stats.counts)}, distinct=${analysis.field10Stats.distinctCount}`,
    `  timestamp-like range: ${analysis.field10Stats.earliestTimestampLike?.iso ?? '-'} .. ${analysis.field10Stats.latestTimestampLike?.iso ?? '-'}`,
    `Payloads: LZSS=${analysis.payloadStats.lzss.count} (${analysis.payloadStats.lzss.percentage}%), stored=${analysis.payloadStats.stored.count} (${analysis.payloadStats.stored.percentage}%), zero-payload=${analysis.payloadStats.none.count} (${analysis.payloadStats.none.percentage}%)`,
    `LZSS profiles: asktao-17=${analysis.lzssProfiles.asktao17.count}, okumura-18=${analysis.lzssProfiles.okumura18.count}, unknown=${analysis.lzssProfiles.unknown.count}`,
    `Ordering: fallback=${analysis.orderingStats.matchingBlocks}/${analysis.orderingStats.blockCount} blocks (${analysis.orderingStats.matchingPercentage}%)`,
    `Layout: regions=${analysis.layoutStats.nonzeroRegionCount}, continuous=${analysis.layoutStats.continuousRegionCount}, positiveGaps=${analysis.layoutStats.positiveGapCount}, paddingBytes=${analysis.layoutStats.totalPaddingBytes}, trailingBytes=${analysis.layoutStats.trailingBytes}`,
    `Alignments: ${analysis.layoutStats.offsetAlignments.map((item) => `${item.alignment}=${item.alignedEntries}/${item.totalEntries}`).join(', ')}`,
    `Directories: count=${analysis.directoryStats.count}, maxDepth=${analysis.directoryStats.maximumDepth}, sizeInvariant=${analysis.directoryStats.childSizeInvariantCount}/${analysis.directoryStats.count}, sequentialChildren=${analysis.directoryStats.sequentialChildEntriesCount}/${analysis.directoryStats.count}`,
    `Filenames: maxBytes=${analysis.filenameStats.maximumByteLength}, maxCharacters=${analysis.filenameStats.maximumCharacterLength}, nonAscii=${analysis.filenameStats.nonAsciiCount}, missingNul=${analysis.filenameStats.missingNulTerminatorCount}, nonzeroPadding=${analysis.filenameStats.nonzeroPaddingCount}`,
  ]
  if (analysis.orderingStats.examples.length > 0) {
    lines.push('Ordering examples:')
    for (const example of analysis.orderingStats.examples)
      lines.push(
        `  ${example.directoryPath}: actual=${JSON.stringify(example.actualFirstNames)}, fallback=${JSON.stringify(example.fallbackFirstNames)}`,
      )
  }
  if (analysis.zeroPayloadEntries.length === 0)
    lines.push('Zero-payload entries: none')
  else {
    lines.push('Zero-payload entries:')
    for (const entry of analysis.zeroPayloadEntries)
      lines.push(
        `  ${entry.path}: field00=${entry.field00Hex}, offset=${entry.dataOffset}, packed=${entry.packedSize}, unpacked=${entry.unpackedSize}, field10=${entry.field10Hex}`,
      )
  }
  return lines.join('\n')
}

export function analyzeArchive(
  filename: string,
  options: AnalyzeOptions,
): void {
  const archive = parsePak(fs.readFileSync(filename))
  const analysis = analyzePak(archive, { archive: filename })
  console.log(
    options.json ? JSON.stringify(analysis, null, 2) : formatAnalysis(analysis),
  )
}
