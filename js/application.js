// Requirements:
//    Backbone.js             (> 0.9.2)
//    Backbone.localStorage   (> 1.0)
//    Underscore              (> 1.3.3)
//    Handlebars.js           (> 1.0.0.beta.6)
//    jQuery                  (> 1.7.2)
//    Soundcloud SDK
$(function(){

  // Action history, allows us to undo changes in the models.
  var ActionHistory = function () {
    var stack = [];

    // Registers a new action, any return values in the doAction 
    // callback is provided as an argument in the undoAction callback.
    this.newAction = function (doAction, undoAction, context) {
      // doActionResult is appended after the action is pushed to 
      // the stack to ensure the stack contains objects before
      // rendering is done in the views.
      var idx = stack.push( { undoAction: undoAction, context: context } );
      stack[idx-1].doActionResult = doAction.call(context);
    };

    // Undo the last registered action using the registered undoAction.
    this.undo = function () {
      if (stack.length > 0) {
        var step = stack.pop();
        step.undoAction.call(step.context, step.doActionResult);
      }
    };

    this.length = function () {
      return stack.length;
    }
  }

  var history = new ActionHistory;

  // Models
  var TrackModel = Backbone.Model.extend({
    // Default attributes
    defaults: function() {
      return {
        title: "",
        trackId: 0,
        userId: 0,
        username: ""
      };
    },

    // Set default attributes for tracks if not set previously.
    initialize: function() {
      if (!this.get("title")) {
        this.set({"title": this.defaults.title});
      }
      if (!this.get("trackId")) {
        this.set({"trackId": this.defaults.trackId});
      }
      if (!this.get("userId")) {
        this.set({"userId": this.defaults.userId});
      }
      if (!this.get("username")) {
        this.set({"username": this.defaults.username});
      }
    },

  });

  var PlaylistModel = Backbone.Model.extend({

    // Default attributes
    defaults: function() {
      return {
        title: "Untitled"
      };
    },

    // Ensure that each playlist has a title
    initialize: function(config) {
      if (!this.get("title")) {
        this.set({"title": this.defaults.title});
      }
      
      this.save();
      
      // A new collection is created for each playlist, to make it work with localstorage.
      this.tracks = new (Backbone.Collection.extend({
        model: TrackModel,
        
        localStorage: new Backbone.LocalStorage("sc-playlists-"+this.id+"-tracks"),

      }))();
      this.tracks.fetch()
    },

    // Full nested JSON containing the tracks-collection as well as local attributes.
    toNestedJSON: function() {
      var json = this.toJSON();
      json.tracks = this.tracks.toJSON();
      return json;
    },

  });
   
  var PlaylistCollection = Backbone.Collection.extend({
    model: PlaylistModel,
    
    localStorage: new Backbone.LocalStorage("sc-playlists"),

  });

  // Views
  var PlaylistListView = Backbone.View.extend({

    tagName: "div",

    template: Handlebars.compile($('#tpl-playlist-list').html()),

    events: {
      "keypress #add-playlist": "addPlaylist",
      "click #add-playlist-button": "addPlaylist",
      "click .delete-playlist": "delete",
      "click .undo-action": "undo"
    },

    initialize: function () {
      this.model.on("reset add change remove", this.render, this);
    },

    // Renders the playlist list template using the handlebars template
    render: function () {
      $(this.el).html("");
      this.$el.html( this.template( { playlists: this.model.toJSON(), 
                                      has_history: (history.length() > 0), 
                                      history_length: history.length() } ) );
      return this;
    },

    // Adds a playlist to the model using the input text-box in the UI.
    addPlaylist: function (event) {
      if (event.type === "click") event.preventDefault();
      if (event.type === "keypress" && event.keyCode != 13) return; // Match Enter key
      var inp = $("#add-playlist");
      if (!inp.val()) return;

      history.newAction(function () {
        // The new id is used if the user undo the action (see below).
        return this.model.create( { "title": inp.val() } ).id; 
      }, function (id) { 
        this.model.get(id).destroy();
      }, this);

      inp.val('');
    },

    // Deletes a playlist after the user confirmed the deletion.
    delete: function (event) {
      event.preventDefault();
      var model = this.model.get($(event.currentTarget).attr('data-id'));
      var doRemove = confirm("Are you sure you would like to delete the playlist '"+model.get("title")+"'? This cannot be undone.");
      if (doRemove) {
        history.newAction(function () {
          var oldValue = model.toNestedJSON();
          model.destroy();
          return oldValue;
        }, function (oldValue) { 
          this.model.create(oldValue);
        }, this);
      }
    },

    // Undo the last action using action history
    undo: function (event) {
      event.preventDefault();
      history.undo();
      this.render();
    }

  });

  var PlaylistView = Backbone.View.extend({

    tagName: "div",

    template: Handlebars.compile($('#tpl-playlist-show').html()),

    events: {
      "dblclick #playlist-title": "edit",
      "click #edit-playlist":  "edit",
      "click #playlist-save": "save",
      "click .playpause-track":  "playPauseTrack",
      "click .delete-track":  "deleteTrack",
      "keypress #add-track": "addTrack",
      "click #add-track-button": "addTrack",
      "click .undo-action": "undo"
    },

    initialize: function () {
        // Re-render page when playlist or track changes.
        this.model.bind("reset change", this.render, this);
        this.model.tracks.bind("add change remove", this.render, this);
    },

    // Renders the "show playlist" template using the handlebars template
    // history length is added to the template.
    render: function () {
        $(this.el).html("");
        var obj = this.model.toNestedJSON();
        obj.has_history = (history.length() > 0);
        obj.history_length = history.length();
        this.$el.html(this.template(obj));
        return this;
    },

    // Turn on editing of the playlist
    edit: function (event) {
      event.preventDefault();
      this.$el.addClass("editing");
      this.$('.edit.focus').focus();
    },

    // Saves the edited playlist
    save: function (event) {
      event.preventDefault();
      var title = $('#playlist-title .edit').val(),
          description = $('#playlist-description .edit').val();

      history.newAction(function () {
        var oldValue = { title: this.model.get("title"), description: this.model.get("description") };
        this.model.save( { title: title, description: description } );
        return oldValue;
      }, function (oldValue) { 
        this.model.save( oldValue );
      }, this);
      
      this.$el.removeClass("editing");
    },

    // Deletes a track. Ask user for confirmation before deletion.
    deleteTrack: function (event) {
      event.preventDefault();
      var trackId = $(event.currentTarget).attr('data-track-id');
      var track = this.model.tracks.get(trackId);
      var doRemove = confirm("Are you sure you would like to delete the track '"+track.get("title")+"'? This cannot be undone.");
      if (doRemove) {
        history.newAction(function () {
          var oldValue = track.toJSON();
          track.destroy();
          return oldValue;
        }, function (oldValue) { 
          this.model.tracks.create( oldValue );
        }, this);
      }
    },

    // Adds a track to a playlist using the soundcloud url.
    // The track is looked up on soundcloud using the resolve API call.
    // If the track is not found/invalid an alert is shown.
    addTrack: function (event) {
      if (event.type === "click") event.preventDefault();
      if (event.type === "keypress" && event.keyCode != 13) return;  // Match Enter key
      var inp = $("#add-track");
      if (!inp.val()) return;
      var self = this;

      // Find track on soundcloud using resolver
      var scTrack = SC.get("/resolve", {url: inp.val()}, function (obj, err) {
        if (err === null && typeof(obj.kind) !== 'undefined' && obj.kind == "track") {
          // The track was found.
          history.newAction(function () {
            return this.model.tracks.create( { title: obj.title, 
                                               trackId: obj.id, 
                                               userId: obj.user_id, 
                                               username: obj.user.username }).id;
          }, function (id) { 
            this.model.tracks.get(id).destroy();
          }, self);
        } else {
          // Track not found/invalid
          alert("The provided url is not a valid soundcloud track.");
        }
      });

      inp.val('');
    },

    // Plays or pauses a track depending on the current playback state.
    playPauseTrack: function (event) {
      event.preventDefault();

      var newTrackId = $(event.currentTarget).attr('data-track-id');
      var track = this.model.tracks.get(newTrackId);
      var trackIndex = this.model.tracks.indexOf(track);

      if (this.currentTrackIndex == trackIndex) {
        // Clicked track is currently playing
        this.currentTrack.togglePause();
      } else {
        // Another track was clicked.
        if (this.currentTrackIndex !== null && this.currentTrack !== null) {
          this.currentTrack.pause();
        }

        this.loopTracks(trackIndex);
      }
    },

    // State variables used to keep track of which track is currently playing.
    currentTrackIndex: null,
    currentTrack: null,

    // Resets the play/pause icons next to all the tracks, to the initial state.
    resetPlayPauseIcons: function () {
      $('.playpause-track i.icon-play').show();
      $('.playpause-track i.icon-pause').hide();
    },

    // Starts to play the specified track. When the track is done, 
    // the next track on the playlist is started.
    // Streaming is done using the soundcloud javascript streaming API.
    loopTracks: function (startIndex) {
      this.currentTrackIndex = startIndex;
      this.resetPlayPauseIcons();

      // Find track
      var track = this.model.tracks.at(this.currentTrackIndex);
      var trackId = track.get("id");
      
      var self = this;
      // Begin to stream and play the track.
      SC.stream("/tracks/"+track.get('trackId'), {
        autoPlay: true,
        onplay: function () {
          self.currentTrack = this;
          // Setup playback icons correctly when the track starts to play.
          $('#playpause-track-'+trackId+' i.icon-play').hide();
          $('#playpause-track-'+trackId+' i.icon-pause').show();
        },
        onpause: function () {
          // Setup playback icons correctly when the track is paused.
          $('#playpause-track-'+trackId+' i.icon-play').show();
          $('#playpause-track-'+trackId+' i.icon-pause').hide();
        },
        onfinish: function () {
          // Play next track on playlist, if the end of the playlist has not 
          // yet been reached.
          var newIndex = self.currentTrackIndex+1;
          if (newIndex < self.model.tracks.length) {
            self.loopTracks(newIndex);
          } else {
            currentTrackIndex = null;
            currentTrack = null;
            self.resetPlayPauseIcons();
          }
        }
      });
    },

    // Undo the last action using action history
    undo: function (event) {
      event.preventDefault();
      history.undo();
      this.render();
    }

  });

  // Router
  var AppRouter = Backbone.Router.extend({
   
      routes: {
          "":"playlists",
          "playlists/:id": "showPlaylist"
      },

      initialize: function () {
        // Initialise the playlist collection so it can be used in all pages
        this.playlistList = new PlaylistCollection;
      },
   
      // Shows the playlist overview page
      playlists: function () {
        this.playlistListView = new PlaylistListView({model:this.playlistList});
        this.playlistList.fetch();
        $('#content').html(this.playlistListView.render().el);        
      },
   
      // Shows a specific playlist
      showPlaylist: function (id) {
        this.playlistList.fetch();
        this.playlist = this.playlistList.get(id);
        this.playlistView = new PlaylistView( { model: this.playlist } );
        $('#content').html(this.playlistView.render().el);
      }
  });

  // Startup router and app!
  var app = new AppRouter();
  Backbone.history.start();

});
