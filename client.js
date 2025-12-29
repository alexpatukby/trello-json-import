/* global TrelloPowerUp */

// Use an absolute URL; Trello may render the button outside the iframe context.
const ICON_URL = new URL('./icon.svg', window.location.href).toString();
const APP_KEY = window.TRELLO_IMPORT_APP_KEY || 'YOUR_TRELLO_API_KEY';

TrelloPowerUp.initialize(
  {
    'board-buttons': function (t) {
      return [
        {
          icon: ICON_URL,
          text: 'Import JSON/CSV',
          callback: function (t) {
            return t.popup({
              title: 'Import JSON/CSV',
              url: './import.html',
              height: 680,
            });
          },
        },
      ];
    },
  },
  {
    appKey: APP_KEY,
    appName: 'JSON/CSV Importer',
  }
);


