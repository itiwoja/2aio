import React from 'react';
import { Box, Text } from 'ink';
import { color, glyph } from '../theme.js';
import { pages } from '../data/mock.js';

// 縦を詰めるため「n / 5」は別行にせず右端へ寄せて1行に収める。
export default function PageNav({ page }) {
  return (
    <Box paddingX={1} justifyContent="center">
      <Text color={page > 0 ? color.stone : color.stoneDim}>{glyph.left}</Text>
      {pages.map((p, i) => (
        <Box key={p} marginLeft={2}>
          <Text color={i === page ? color.stoneBright : color.stoneDim} bold={i === page}>
            {i === page ? `[ ${p} ]` : `  ${p}  `}
          </Text>
        </Box>
      ))}
      <Box marginLeft={2}>
        <Text color={page < pages.length - 1 ? color.stone : color.stoneDim}>{glyph.right}</Text>
      </Box>
      <Box marginLeft={3}>
        <Text color={color.muted}>
          {page + 1} / {pages.length}
        </Text>
      </Box>
    </Box>
  );
}
