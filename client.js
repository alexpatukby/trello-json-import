/* global TrelloPowerUp */

const ICON_URL = './icon.svg';

TrelloPowerUp.initialize({
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
});


