import { Box, Typography, Breadcrumbs, Link } from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';
import type { ReactNode } from 'react';

interface PageHeaderProps {
  /** Kept for call-site compatibility; TopBar usually shows the page title. */
  title?: string;
  /** Optional supporting line under breadcrumbs / beside actions. */
  subtitle?: string;
  breadcrumbs?: { label: string; path?: string }[];
  action?: ReactNode;
}

export function PageHeader({ breadcrumbs, action, subtitle }: PageHeaderProps) {
  const hasBreadcrumbs = Boolean(breadcrumbs && breadcrumbs.length > 0);
  if (!hasBreadcrumbs && !action && !subtitle) {
    return null;
  }

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: { xs: 'column', sm: 'row' },
        alignItems: { sm: 'center' },
        justifyContent: 'space-between',
        gap: 1.5,
        mb: action || hasBreadcrumbs || subtitle ? 2 : 0,
      }}
    >
      <Box>
        {hasBreadcrumbs && (
          <Breadcrumbs>
            {breadcrumbs!.map((crumb, i) =>
              crumb.path ? (
                <Link
                  key={i}
                  component={RouterLink}
                  to={crumb.path}
                  underline="hover"
                  color="inherit"
                  variant="body2"
                >
                  {crumb.label}
                </Link>
              ) : (
                <Typography key={i} variant="body2" color="text.secondary">
                  {crumb.label}
                </Typography>
              ),
            )}
          </Breadcrumbs>
        )}
        {subtitle ? (
          <Typography
            variant="body2"
            color="text.secondary"
            sx={{ mt: hasBreadcrumbs ? 0.5 : 0 }}
          >
            {subtitle}
          </Typography>
        ) : null}
      </Box>
      {action && <Box sx={{ flexShrink: 0 }}>{action}</Box>}
    </Box>
  );
}
