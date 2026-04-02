import { AppBar, Toolbar, Typography, Button, Box, IconButton } from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';
import { Home, History, Settings, DarkMode, LightMode } from '@mui/icons-material';
import { useThemeStore } from '../store/theme';

interface LayoutProps {
  children: React.ReactNode;
}

export default function Layout({ children }: LayoutProps) {
  const { mode, toggle } = useThemeStore();
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
      <AppBar position="static">
        <Toolbar>
          <Box
            component={RouterLink}
            to="/"
            sx={{ 
              display: 'flex', 
              alignItems: 'center', 
              textDecoration: 'none',
              color: 'inherit',
              mr: 2
            }}
          >
            <img 
              src="/favicon.svg" 
              alt="Logo" 
              style={{ width: 32, height: 32, marginRight: 8 }} 
            />
            <Typography variant="h6" component="span" sx={{ display: { xs: 'none', sm: 'block' } }}>
              Container Image Compare
            </Typography>
          </Box>
          <Box sx={{ flexGrow: 1 }} />
          <Button color="inherit" component={RouterLink} to="/" startIcon={<Home />}>
            Home
          </Button>
          <Button color="inherit" component={RouterLink} to="/history" startIcon={<History />}>
            History
          </Button>
          <Button color="inherit" component={RouterLink} to="/settings" startIcon={<Settings />}>
            Settings
          </Button>
          <IconButton color="inherit" onClick={toggle} sx={{ ml: 1 }}>
            {mode === 'dark' ? <LightMode /> : <DarkMode />}
          </IconButton>
        </Toolbar>
      </AppBar>
      <Box component="main" sx={{ flexGrow: 1, p: 3, bgcolor: 'background.default' }}>
        {children}
      </Box>
    </Box>
  );
}
