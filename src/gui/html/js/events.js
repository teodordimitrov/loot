/* eslint-disable no-unused-vars */
import {askQuestion, closeProgress, showNotification, showProgress} from './dialog.js';

// Depends on the following globals:
// - loot.DOM
// - loot.Plugin
// - loot.Filters
// - loot.filters
// - loot.query
// - loot.handlePromiseError
// - loot.game
// - loot.l10n
// - loot.settings
// - loot.state
// - loot.installedGames

export function onSidebarFilterToggle(evt) {
  loot.filters[evt.target.id] = evt.target.checked;

  const payload = {
    name: evt.target.id,
    state: evt.target.checked
  };
  loot.query('saveFilterState', payload).catch(loot.handlePromiseError);
  loot.filters.apply(loot.game.plugins);
}
export function onContentFilter(evt) {
  loot.filters.contentSearchString = evt.target.value;
  loot.filters.apply(loot.game.plugins);
}
export function onConflictsFilter(evt) {
  /* evt.currentTarget.value is the name of the target plugin, or an empty string
     if the filter has been deactivated. */
  if (evt.currentTarget.value) {
    /* Now get conflicts for the plugin. */
    showProgress(
      loot.l10n.translate('Identifying conflicting plugins...')
    );
    loot.filters
      .activateConflictsFilter(evt.currentTarget.value)
      .then(plugins => {
        plugins.forEach(plugin => {
          const gamePlugin = loot.game.plugins.find(
            item => item.name === plugin.name
          );
          if (gamePlugin) {
            gamePlugin.update(plugin);
          }
        });
        loot.filters.apply(loot.game.plugins);

        /* Scroll to the target plugin */
        const list = document.getElementById('pluginCardList');
        const index = list.items.findIndex(
          item => item.name === evt.target.value
        );
        list.scrollToIndex(index);

        closeProgress();
      })
      .catch(loot.handlePromiseError);
  } else {
    loot.filters.deactivateConflictsFilter();
    loot.filters.apply(loot.game.plugins);
  }
}

export function onChangeGame(evt) {
  if (
    evt.detail.item.getAttribute('value') === loot.game.folder ||
    loot.game.folder.length === 0
  ) {
    // Game folder length is zero if LOOT is being initalised.
    return;
  }
  /* Send off a CEF query with the folder name of the new game. */
  loot
    .query('changeGame', evt.detail.item.getAttribute('value'))
    .then(result => {
      /* Filters should be re-applied on game change, except the conflicts
       filter. Don't need to deactivate the others beforehand. Strictly not
       deactivating the conflicts filter either, just resetting it's value.
       */
      loot.filters.deactivateConflictsFilter();

      /* Clear the UI of all existing game-specific data. Also
       clear the card and li variables for each plugin object. */
      const generalMessages = document
        .getElementById('summary')
        .getElementsByTagName('ul')[0];
      while (generalMessages.firstElementChild) {
        generalMessages.removeChild(generalMessages.firstElementChild);
      }

      /* Parse the data sent from C++. */
      const gameInfo = JSON.parse(result, loot.Plugin.fromJson);
      loot.game = new loot.Game(gameInfo, loot.l10n);

      loot.game.initialiseUI(loot.DOM, loot.Filters);

      /* Now update virtual lists. */
      if (loot.filters.areAnyFiltersActive()) {
        loot.filters.apply(loot.game.plugins);
      } else {
        loot.DOM.initialiseVirtualLists(loot.game.plugins);
      }

      closeProgress();
    })
    .catch(loot.handlePromiseError);
}
/* Masterlist update process, minus progress dialog. */
export function updateMasterlist() {
  showProgress(
    loot.l10n.translate('Updating and parsing masterlist...')
  );
  return loot
    .query('updateMasterlist')
    .then(JSON.parse)
    .then(result => {
      if (result) {
        /* Update JS variables. */
        loot.game.masterlist = result.masterlist;
        loot.game.generalMessages = result.generalMessages;

        /* Update Bash Tag autocomplete suggestions. */
        loot.DOM.initialiseAutocompleteBashTags(result.bashTags);

        result.plugins.forEach(resultPlugin => {
          const existingPlugin = loot.game.plugins.find(
            plugin => plugin.name === resultPlugin.name
          );
          if (existingPlugin) {
            existingPlugin.update(resultPlugin);
          }
        });

        showNotification(
          loot.l10n.translateFormatted(
            'Masterlist updated to revision %s.',
            loot.game.masterlist.revision
          )
        );
      } else {
        showNotification(
          loot.l10n.translate('No masterlist update was necessary.')
        );
      }
    })
    .catch(loot.handlePromiseError);
}
export function onUpdateMasterlist() {
  updateMasterlist()
    .then(() => {
      closeProgress();
    })
    .catch(loot.handlePromiseError);
}
export function onSortPlugins() {
  if (loot.filters.deactivateConflictsFilter()) {
    /* Conflicts filter was undone, update the displayed cards. */
    loot.filters.apply(loot.game.plugins);
  }

  let promise = Promise.resolve();
  if (loot.settings.updateMasterlist) {
    promise = promise.then(updateMasterlist);
  }
  promise
    .then(() => loot.query('sortPlugins'))
    .then(JSON.parse)
    .then(result => {
      if (!result) {
        return;
      }

      loot.game.generalMessages = result.generalMessages;

      if (!result.plugins || result.plugins.length === 0) {
        const message = result.generalMessages.find(item =>
          item.text.startsWith('Cyclic interaction detected')
        );
        const text = message
          ? message.text
          : 'see general messages for details.';
        throw new Error(
          loot.l10n.translateFormatted(
            'Failed to sort plugins. Details: %s',
            text
          )
        );
      }

      /* Check if sorted load order differs from current load order. */
      const loadOrderIsUnchanged = result.plugins.every(
        (plugin, index) => plugin.name === loot.game.plugins[index].name
      );
      if (loadOrderIsUnchanged) {
        result.plugins.forEach(plugin => {
          const existingPlugin = loot.game.plugins.find(
            item => item.name === plugin.name
          );
          if (existingPlugin) {
            existingPlugin.update(plugin);
          }
        });
        /* Send discardUnappliedChanges query. Not doing so prevents LOOT's window
         from closing. */
        loot.query('discardUnappliedChanges');
        closeProgress();
        showNotification(
          loot.l10n.translate('Sorting made no changes to the load order.')
        );
        return;
      }
      loot.game.setSortedPlugins(result.plugins);

      /* Now update the UI for the new order. */
      loot.filters.apply(loot.game.plugins);

      loot.state.enterSortingState();

      closeProgress();
    })
    .catch(loot.handlePromiseError);
}
export function onApplySort() {
  const loadOrder = loot.game.getPluginNames();
  return loot
    .query('applySort', loadOrder)
    .then(() => {
      loot.game.applySort();

      loot.state.exitSortingState();
    })
    .catch(loot.handlePromiseError);
}
export function onCancelSort() {
  return loot
    .query('cancelSort')
    .then(JSON.parse)
    .then(response => {
      loot.game.cancelSort(response.plugins, response.generalMessages);
      /* Sort UI elements again according to stored old load order. */
      loot.filters.apply(loot.game.plugins);

      loot.state.exitSortingState();
    })
    .catch(loot.handlePromiseError);
}

export function onRedatePlugins(evt) {
  askQuestion(
    loot.l10n.translate('Redate Plugins?'),
    loot.l10n.translate(
      'This feature is provided so that modders using the Creation Kit may set the load order it uses. A side-effect is that any subscribed Steam Workshop mods will be re-downloaded by Steam (this does not affect Skyrim Special Edition). Do you wish to continue?'
    ),
    loot.l10n.translate('Redate'),
    result => {
      if (result) {
        loot
          .query('redatePlugins')
          .then(() => {
            showNotification(
              loot.l10n.translate('Plugins were successfully redated.')
            );
          })
          .catch(loot.handlePromiseError);
      }
    }
  );
}
export function onClearAllMetadata() {
  askQuestion(
    '',
    loot.l10n.translate(
      'Are you sure you want to clear all existing user-added metadata from all plugins?'
    ),
    loot.l10n.translate('Clear'),
    result => {
      if (!result) {
        return;
      }
      loot
        .query('clearAllMetadata')
        .then(JSON.parse)
        .then(response => {
          if (!response || !response.plugins) {
            return;
          }

          loot.game.clearMetadata(response.plugins);

          showNotification(
            loot.l10n.translate('All user-added metadata has been cleared.')
          );
        })
        .catch(loot.handlePromiseError);
    }
  );
}
export function onCopyContent() {
  let content = {
    messages: [],
    plugins: []
  };

  if (loot.game) {
    content = loot.game.getContent();
  } else {
    const message = document
      .getElementById('summary')
      .getElementsByTagName('ul')[0].firstElementChild;

    const { language = 'en' } = loot.settings || {};

    if (message) {
      content.messages.push({
        type: message.className,
        text: message.textContent,
        language
      });
    }
  }

  loot
    .query('copyContent', content)
    .then(() => {
      showNotification(
        loot.l10n.translate("LOOT's content has been copied to the clipboard.")
      );
    })
    .catch(loot.handlePromiseError);
}
export function onCopyLoadOrder() {
  let plugins = [];

  if (loot.game && loot.game.plugins) {
    plugins = loot.game.getPluginNames();
  }

  loot
    .query('copyLoadOrder', plugins)
    .then(() => {
      showNotification(
        loot.l10n.translate('The load order has been copied to the clipboard.')
      );
    })
    .catch(loot.handlePromiseError);
}
export function onContentRefresh() {
  /* Send a query for updated load order and plugin header info. */
  loot
    .query('getGameData')
    .then(result => {
      /* Parse the data sent from C++. */
      const game = JSON.parse(result, loot.Plugin.fromJson);
      loot.game = new loot.Game(game, loot.l10n);

      /* Re-initialise conflicts filter plugin list. */
      loot.Filters.fillConflictsFilterList(loot.game.plugins);

      /* Reapply filters. */
      if (loot.filters.areAnyFiltersActive()) {
        loot.filters.apply(loot.game.plugins);
      } else {
        loot.DOM.initialiseVirtualLists(loot.game.plugins);
      }

      closeProgress();
    })
    .catch(loot.handlePromiseError);
}

export function onOpenReadme() {
  loot.query('openReadme').catch(loot.handlePromiseError);
}
export function onOpenLogLocation() {
  loot.query('openLogLocation').catch(loot.handlePromiseError);
}
export function handleUnappliedChangesClose(change) {
  askQuestion(
    '',
    loot.l10n.translateFormatted(
      'You have not yet applied or cancelled your %s. Are you sure you want to quit?',
      change
    ),
    loot.l10n.translate('Quit'),
    result => {
      if (!result) {
        return;
      }
      /* Discard any unapplied changes. */
      loot
        .query('discardUnappliedChanges')
        .then(() => {
          window.close();
        })
        .catch(loot.handlePromiseError);
    }
  );
}
export function onQuit() {
  if (loot.state.isInSortingState()) {
    handleUnappliedChangesClose(loot.l10n.translate('sorted load order'));
  } else if (loot.state.isInEditingState()) {
    handleUnappliedChangesClose(loot.l10n.translate('metadata edits'));
  } else {
    window.close();
  }
}
export function onApplySettings(evt) {
  if (!document.getElementById('gameTable').validate()) {
    evt.stopPropagation();
  }
}
export function onCloseSettingsDialog(evt) {
  if (evt.target.id !== 'settingsDialog') {
    /* The event can be fired by dropdowns in the settings dialog, so ignore
       any events that don't come from the dialog itself. */
    return;
  }
  if (!evt.detail.confirmed) {
    /* Re-apply the existing settings to the settings dialog elements. */
    loot.DOM.updateSettingsDialog(loot.settings);
    return;
  }

  /* Update the JS variable values. */
  const settings = {
    enableDebugLogging: document.getElementById('enableDebugLogging').checked,
    game: document.getElementById('defaultGameSelect').value,
    games: document.getElementById('gameTable').getRowsData(false),
    language: document.getElementById('languageSelect').value,
    lastGame: loot.settings.lastGame,
    updateMasterlist: document.getElementById('updateMasterlist').checked,
    filters: loot.settings.filters
  };

  /* Send the settings back to the C++ side. */
  loot
    .query('closeSettings', settings)
    .then(JSON.parse)
    .then(response => {
      loot.installedGames = response.installedGames;
      loot.DOM.updateEnabledGames(loot.installedGames);
      if (loot.installedGames.length > 0) {
        loot.DOM.enableGameOperations(true);
      }
    })
    .catch(loot.handlePromiseError)
    .then(() => {
      loot.settings = settings;
      loot.DOM.updateSettingsDialog(loot.settings);
      loot.DOM.setGameMenuItems(loot.settings.games);
      loot.DOM.updateEnabledGames(loot.installedGames);
      loot.DOM.updateSelectedGame(loot.game.folder);
    })
    .then(() => {
      if (loot.installedGames.length > 0 && loot.game.folder.length === 0) {
        /* Initialisation failed and game was configured in settings. */
        onContentRefresh();
      }
    })
    .catch(loot.handlePromiseError);
}
export function onEditorOpen(evt) {
  /* Set the editor data. */
  document.getElementById('editor').setEditorData(evt.target.data);

  loot.state.enterEditingState();

  /* Sidebar items have been resized. */
  document.getElementById('cardsNav').notifyResize();

  /* Update the plugin's editor state tracker */
  evt.target.data.isEditorOpen = true;

  /* Set up drag 'n' drop event handlers. */
  const elements = document
    .getElementById('cardsNav')
    .getElementsByTagName('loot-plugin-item');
  for (let i = 0; i < elements.length; i += 1) {
    elements[i].draggable = true;
    elements[i].addEventListener('dragstart', elements[i].onDragStart);
  }

  return loot.query('editorOpened').catch(loot.handlePromiseError);
}
export function onEditorClose(evt) {
  const plugin = loot.game.plugins.find(
    item => item.name === evt.target.querySelector('h1').textContent
  );
  /* Update the plugin's editor state tracker */
  plugin.isEditorOpen = false;

  /* evt.detail is true if the apply button was pressed. */
  const metadata = evt.target.readFromEditor();
  const payload = {
    applyEdits: evt.detail,
    metadata
  };

  loot
    .query('editorClosed', payload)
    .then(JSON.parse)
    .then(result => {
      plugin.update(result);

      /* Explicitly set userlist to detect when user edits have been removed
       (so result.userlist is not present). */
      plugin.userlist = result.userlist;

      /* Now perform search again. If there is no current search, this won't
       do anything. */
      document.getElementById('searchBar').search();
    })
    .catch(loot.handlePromiseError)
    .then(() => {
      loot.state.exitEditingState();
      /* Sidebar items have been resized. */
      document.getElementById('cardsNav').notifyResize();

      /* Remove drag 'n' drop event handlers. */
      const elements = document
        .getElementById('cardsNav')
        .getElementsByTagName('loot-plugin-item');
      for (let i = 0; i < elements.length; i += 1) {
        elements[i].removeAttribute('draggable');
        elements[i].removeEventListener('dragstart', elements[i].onDragStart);
      }
    })
    .catch(loot.handlePromiseError);
}
export function onCopyMetadata(evt) {
  loot
    .query('copyMetadata', evt.target.getName())
    .then(() => {
      showNotification(
        loot.l10n.translateFormatted(
          'The metadata for "%s" has been copied to the clipboard.',
          evt.target.getName()
        )
      );
    })
    .catch(loot.handlePromiseError);
}
export function onClearMetadata(evt) {
  askQuestion(
    '',
    loot.l10n.translateFormatted(
      'Are you sure you want to clear all existing user-added metadata from "%s"?',
      evt.target.getName()
    ),
    loot.l10n.translate('Clear'),
    result => {
      if (!result) {
        return;
      }
      loot
        .query('clearPluginMetadata', evt.target.getName())
        .then(JSON.parse)
        .then(plugin => {
          if (!result) {
            return;
          }
          /* Need to empty the UI-side user metadata. */
          const existingPlugin = loot.game.plugins.find(
            item => item.id === evt.target.id
          );
          if (existingPlugin) {
            existingPlugin.userlist = undefined;

            existingPlugin.update(plugin);
          }
          showNotification(
            loot.l10n.translateFormatted(
              'The user-added metadata for "%s" has been cleared.',
              evt.target.getName()
            )
          );
          /* Now perform search again. If there is no current search, this won't
         do anything. */
          document.getElementById('searchBar').search();
        })
        .catch(loot.handlePromiseError);
    }
  );
}

export function onSearchBegin(evt) {
  loot.game.plugins.forEach(plugin => {
    plugin.isSearchResult = false;
  });

  if (!evt.detail.needle) {
    return;
  }

  // Don't push to the target's results property directly, as the
  // change observer doesn't work correctly unless special Polymer APIs
  // are used, which I don't want to get into.
  const results = [];
  loot.game.plugins.forEach((plugin, index) => {
    if (plugin.getCardContent(loot.filters).containsText(evt.detail.needle)) {
      results.push(index);
      plugin.isSearchResult = true;
    }
  });

  evt.target.results = results;
}
export function onSearchEnd(evt) {
  loot.game.plugins.forEach(plugin => {
    plugin.isSearchResult = false;
  });
  document.getElementById('mainToolbar').classList.remove('search');
}
export function onFolderChange(evt) {
  loot.DOM.updateSelectedGame(evt.detail.folder);
  /* Enable/disable the redate plugins option. */
  let gameSettings;
  if (loot.settings && loot.settings.games) {
    gameSettings = loot.settings.games.find(
      game =>
        (game.type === 'Skyrim' || game.type === 'Skyrim Special Edition') &&
        game.folder === evt.detail.folder
    );
  }
  loot.DOM.enable('redatePluginsButton', gameSettings !== undefined);
}
