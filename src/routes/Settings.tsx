import { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  IconButton,
  List,
  ListItem,
  ListItemText,
  MenuItem,
  Select,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import { useWidgetApi } from '@matrix-widget-toolkit/react';
import {
  loadSettings,
  saveSettings,
  type HuddleSettings,
  type SummarizationMode,
} from '../matrix/settingsSync';
import { useResolveRoomNames } from '../matrix/useResolveRoomNames';
import { GEMMA_MODEL_OPTIONS, type GemmaModelId } from '../model/GemmaEdgeModel';
import { GEMINI_MODEL_OPTIONS, type GeminiModelId } from '../model/geminiModel';
import { deleteStoredModel, getStoredModelSize, storeModelFile } from '../model/modelStorage';
import { prepareModel, resetLocalModel } from '../agent/summarize';
import { useSettingsStore } from '../state/settingsStore';
import { useModelStore } from '../state/modelStore';
import { useApiKeyStore } from '../state/apiKeyStore';

function formatBytes(bytes: number): string {
  const gb = bytes / 1024 ** 3;
  if (gb >= 0.1) return `${gb.toFixed(1)} GB`;
  return `${(bytes / 1024 ** 2).toFixed(0)} MB`;
}

export function Settings() {
  const widgetApi = useWidgetApi();
  const userId = widgetApi.widgetParameters.userId ?? '';
  const { settings, loaded, setSettings, setLoaded } = useSettingsStore();
  const modelStatus = useModelStore((s) => s.status);
  const modelError = useModelStore((s) => s.error);
  const setModelStatus = useModelStore((s) => s.setStatus);
  const { apiKey, storageError, setApiKey } = useApiKeyStore();

  const [newRoomId, setNewRoomId] = useState('');
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [uploadState, setUploadState] = useState<
    { status: 'idle' | 'uploading' | 'error'; progress?: number; error?: string }
  >({ status: 'idle' });
  const [storedSize, setStoredSize] = useState<number | undefined>();

  useEffect(() => {
    if (loaded || !userId) return;
    loadSettings(widgetApi, userId).then((loadedSettings) => {
      setSettings(loadedSettings);
      setLoaded(true);
    });
  }, [widgetApi, userId, loaded, setSettings, setLoaded]);

  // Refresh "is a copy already uploaded, how big" whenever the selected
  // local variant changes — each variant (E2B/E4B) is stored separately.
  useEffect(() => {
    let cancelled = false;
    getStoredModelSize(settings.localModel).then((size) => {
      if (!cancelled) setStoredSize(size);
    });
    return () => {
      cancelled = true;
    };
  }, [settings.localModel]);

  const handleUploadModel = async (file: File) => {
    const modelId = settings.localModel;
    setUploadState({ status: 'uploading', progress: 0 });
    try {
      await storeModelFile(modelId, file, (written, total) => {
        setUploadState({ status: 'uploading', progress: total > 0 ? written / total : undefined });
      });
      // The cached GemmaEdgeModel (if any) may already have an inference
      // session built from an old file for this variant — drop it so the
      // next prepare picks up what was just uploaded, and clear "Ready"
      // status since it no longer reflects reality until re-prepared.
      resetLocalModel(modelId);
      setModelStatus(modelId, 'idle');
      setUploadState({ status: 'idle' });
      setStoredSize(await getStoredModelSize(modelId));
    } catch (err) {
      setUploadState({ status: 'error', error: err instanceof Error ? err.message : String(err) });
    }
  };

  const handleRemoveModel = async () => {
    const modelId = settings.localModel;
    await deleteStoredModel(modelId);
    resetLocalModel(modelId);
    setModelStatus(modelId, 'idle');
    setStoredSize(undefined);
  };

  const roomNames = useResolveRoomNames(widgetApi, settings.roomIds);

  const patch = (next: Partial<HuddleSettings>) => setSettings({ ...settings, ...next });

  const addRoom = () => {
    const roomId = newRoomId.trim();
    if (!roomId || settings.roomIds.includes(roomId)) return;
    patch({ roomIds: [...settings.roomIds, roomId] });
    setNewRoomId('');
  };

  const removeRoom = (roomId: string) => patch({ roomIds: settings.roomIds.filter((id) => id !== roomId) });

  const handleSave = async () => {
    setSaveState('saving');
    try {
      await saveSettings(widgetApi, userId, settings);
      setSaveState('saved');
    } catch {
      setSaveState('error');
    }
  };

  const handlePrepareModel = async (modelId: GemmaModelId) => {
    setModelStatus(modelId, 'preparing');
    try {
      await prepareModel(modelId);
      setModelStatus(modelId, 'ready');
    } catch (err) {
      setModelStatus(modelId, 'error', err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <Stack spacing={3}>
      <Box>
        <Typography variant="subtitle1" gutterBottom>
          Rooms to summarize
        </Typography>
        <Typography variant="body2" color="text.secondary" gutterBottom>
          Add rooms by room ID or alias (e.g. <code>!abc123:example.com</code>). There's no way for the
          widget to list every room you've joined, so rooms are added by hand here.
        </Typography>
        <Stack direction="row" spacing={1} sx={{ mb: 1 }}>
          <TextField
            size="small"
            fullWidth
            placeholder="!room-id:example.com or #alias:example.com"
            value={newRoomId}
            onChange={(e) => setNewRoomId(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addRoom()}
          />
          <Button variant="outlined" onClick={addRoom}>
            Add
          </Button>
        </Stack>
        <List dense disablePadding>
          {settings.roomIds.map((roomId) => (
            <ListItem
              key={roomId}
              disableGutters
              secondaryAction={
                <IconButton edge="end" size="small" onClick={() => removeRoom(roomId)} aria-label="Remove room">
                  ✕
                </IconButton>
              }
            >
              <ListItemText primary={roomNames[roomId] ?? roomId} secondary={roomId} />
            </ListItem>
          ))}
          {settings.roomIds.length === 0 && (
            <Typography variant="body2" color="text.secondary">
              No rooms selected yet.
            </Typography>
          )}
        </List>
      </Box>

      <Box>
        <Typography variant="subtitle1" gutterBottom>
          Summarization
        </Typography>
        <ToggleButtonGroup
          size="small"
          exclusive
          value={settings.mode}
          onChange={(_, value: SummarizationMode | null) => value && patch({ mode: value })}
          sx={{ mb: 1 }}
        >
          <ToggleButton value="local">On-device (private)</ToggleButton>
          <ToggleButton value="gemini">Gemini API (cloud)</ToggleButton>
        </ToggleButtonGroup>

        {settings.mode === 'local' ? (
          <>
            <Typography variant="body2" color="text.secondary" gutterBottom>
              Summaries are generated entirely inside this widget — message content is never sent
              anywhere. Larger models produce better summaries but take longer to download and run.
            </Typography>
            <Select
              size="small"
              fullWidth
              value={settings.localModel}
              onChange={(e) => patch({ localModel: e.target.value as GemmaModelId })}
              sx={{ mb: 1 }}
            >
              {GEMMA_MODEL_OPTIONS.map((opt) => (
                <MenuItem key={opt.id} value={opt.id}>
                  {opt.label} — {opt.note}
                </MenuItem>
              ))}
            </Select>

            {/* Weight files run into the GB range, so they're never bundled
                into this widget's own build — upload your own copy here.
                Stored in this browser only (OPFS), per variant, so it
                doesn't need re-uploading every reload — but it also won't
                follow you to another device/browser, same tradeoff as the
                Gemini API key below. */}
            <Box sx={{ mb: 1 }}>
              <Stack direction="row" spacing={1} alignItems="center">
                <Button component="label" size="small" variant="outlined" disabled={uploadState.status === 'uploading'}>
                  {uploadState.status === 'uploading' ? 'Uploading…' : storedSize ? 'Replace model file' : 'Upload model file'}
                  <input
                    type="file"
                    accept=".litertlm"
                    hidden
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      e.target.value = ''; // allow re-selecting the same file later
                      if (file) void handleUploadModel(file);
                    }}
                  />
                </Button>
                {storedSize !== undefined && uploadState.status !== 'uploading' && (
                  <>
                    <Chip size="small" color="success" label={`Uploaded (${formatBytes(storedSize)})`} />
                    <Button size="small" color="inherit" onClick={() => void handleRemoveModel()}>
                      Remove
                    </Button>
                  </>
                )}
              </Stack>
              {uploadState.status === 'uploading' && (
                <Typography variant="caption" color="text.secondary">
                  {uploadState.progress !== undefined
                    ? `${Math.round(uploadState.progress * 100)}% — this is a multi-GB file, expect it to take a while.`
                    : 'Writing to browser storage…'}
                </Typography>
              )}
              {uploadState.status === 'error' && (
                <Alert severity="error" sx={{ mt: 1 }}>
                  {uploadState.error}
                </Alert>
              )}
              {storedSize === undefined && uploadState.status === 'idle' && (
                <Typography variant="caption" color="text.secondary">
                  No file uploaded for this variant — Prepare model below will fall back to whatever's
                  bundled in this deployment, if anything.
                </Typography>
              )}
            </Box>

            <Stack direction="row" spacing={1} alignItems="center">
              <Button
                size="small"
                variant="outlined"
                disabled={modelStatus[settings.localModel] === 'preparing'}
                onClick={() => handlePrepareModel(settings.localModel)}
              >
                {modelStatus[settings.localModel] === 'preparing' ? 'Preparing…' : 'Prepare model'}
              </Button>
              <ModelStatusChip status={modelStatus[settings.localModel]} />
            </Stack>
            {modelStatus[settings.localModel] === 'error' && (
              <Alert severity="error" sx={{ mt: 1 }}>
                {modelError[settings.localModel]}
              </Alert>
            )}
          </>
        ) : (
          <>
            <Alert severity="warning" sx={{ mb: 1 }}>
              In this mode, the text of today's messages is sent to Google's Gemini API to be
              summarized — unlike the on-device option, message content does leave your browser.
              Only turn this on for rooms/content you're comfortable sending off-device.
            </Alert>
            <Select
              size="small"
              fullWidth
              value={settings.geminiModel}
              onChange={(e) => patch({ geminiModel: e.target.value as GeminiModelId })}
              sx={{ mb: 1 }}
            >
              {GEMINI_MODEL_OPTIONS.map((opt) => (
                <MenuItem key={opt.id} value={opt.id}>
                  {opt.label} — {opt.note}
                </MenuItem>
              ))}
            </Select>
            <TextField
              size="small"
              fullWidth
              type="password"
              label="Gemini API key"
              placeholder="AIza…"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value.trim())}
              helperText="Stored only in this browser (localStorage) — never saved to the Matrix room, never synced across devices."
            />
            {storageError && (
              <Alert severity="warning" sx={{ mt: 1 }}>
                Couldn't persist the key to local storage (some browsers block this for
                cross-site iframes) — it'll work for this session but won't survive a reload.
              </Alert>
            )}
          </>
        )}
      </Box>

      <Box>
        <Typography variant="subtitle1" gutterBottom>
          Summary instruction
        </Typography>
        <TextField
          multiline
          minRows={3}
          fullWidth
          value={settings.instruction}
          onChange={(e) => patch({ instruction: e.target.value })}
        />
      </Box>

      <Stack direction="row" spacing={1} alignItems="center">
        <Button variant="contained" onClick={handleSave} disabled={saveState === 'saving'}>
          {saveState === 'saving' ? 'Saving…' : 'Save settings'}
        </Button>
        {saveState === 'saved' && <Chip size="small" color="success" label="Saved" />}
        {saveState === 'error' && <Chip size="small" color="error" label="Failed to save" />}
      </Stack>
    </Stack>
  );
}

function ModelStatusChip({ status }: { status: 'idle' | 'preparing' | 'ready' | 'error' | undefined }) {
  switch (status) {
    case 'ready':
      return <Chip size="small" color="success" label="Ready" />;
    case 'preparing':
      return <Chip size="small" color="warning" label="Preparing…" />;
    case 'error':
      return <Chip size="small" color="error" label="Failed" />;
    default:
      return <Chip size="small" label="Not prepared" />;
  }
}
