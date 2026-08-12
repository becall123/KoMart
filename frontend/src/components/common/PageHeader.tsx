import { Box, Typography, Breadcrumbs, Link } from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';
import type { ReactNode } from 'react';

interface PageHeaderProps {
  title?: string;
  subtitle?: string;
  subtitleEnd?: ReactNode;
  subtitleEndLabel?: string;
  breadcrumbs?: { label: string; path?: string }[];
  action?: ReactNode;
}

export function PageHeader({ breadcrumbs, action, subtitle, subtitleEnd, subtitleEndLabel }: PageHeaderProps) {
  const hasBreadcrumbs = Boolean(breadcrumbs && breadcrumbs.length > 0);
  if (!hasBreadcrumbs && !action && !subtitle && !subtitleEnd && !subtitleEndLabel) {
    return null;
  }

  const renderSubtitleEnd = () => {
    if (!subtitleEnd && !subtitleEndLabel) return null;
    const content = subtitleEndLabel ? (
      <Box
        sx={{
          display: 'inline-flex',
          alignItems: 'baseline',
          gap: 0.5,
          px: 1.5,
          py: 0.5,
          borderRadius: 1,
          bgcolor: 'primary.main',
          color: 'primary.contrastText',
        }}
      >
        {subtitleEndLabel && (
          <Typography variant="body2" sx={{ fontWeight: 500, opacity: 0.9 }}>
            {subtitleEndLabel}
          </Typography>
        )}
        <Typography variant="body2" sx={{ fontWeight: 700 }}>
          {subtitleEnd}
        </Typography>
      </Box>
    ) : (
      <Typography variant="body2" sx={{ fontWeight: 600, color: 'text.primary', whiteSpace: 'nowrap', flexShrink: 0 }}>
        {subtitleEnd}
      </Typography>
    );
    return content;
  };

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: { xs: 'column', sm: 'row' },
        alignItems: { sm: 'center' },
        justifyContent: 'space-between',
        gap: 1.5,
        mb: action || hasBreadcrumbs || subtitle || subtitleEnd || subtitleEndLabel ? 2 : 0,
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
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 2, mt: hasBreadcrumbs ? 0.5 : 0 }}>
            <Typography variant="body2" color="text.secondary">
              {subtitle}
            </Typography>
            {renderSubtitleEnd()}
          </Box>
        ) : renderSubtitleEnd() ? (
          <Box sx={{ mt: hasBreadcrumbs ? 0.5 : 0, textAlign: 'right' }}>
            {renderSubtitleEnd()}
          </Box>
        ) : null}
      </Box>
      {action && <Box sx={{ flexShrink: 0 }}>{action}</Box>}
    </Box>
  );
}
