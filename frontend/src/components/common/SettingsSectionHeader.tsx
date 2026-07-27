import { Box, Typography } from '@mui/material';
import type { ReactNode } from 'react';

/** Consistent section title + optional description for Settings tabs. */
export function SettingsSectionHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: { xs: 'stretch', sm: 'center' },
        justifyContent: 'space-between',
        flexDirection: { xs: 'column', sm: 'row' },
        gap: 1.5,
        mb: 2,
      }}
    >
      <Box>
        <Typography variant="h6" component="h2">
          {title}
        </Typography>
        {description ? (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>
            {description}
          </Typography>
        ) : null}
      </Box>
      {action ? <Box sx={{ flexShrink: 0 }}>{action}</Box> : null}
    </Box>
  );
}
