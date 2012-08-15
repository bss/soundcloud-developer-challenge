
$(function(){

  var ActionHistory = function () {
    var stack = [];
    this.newAction = function (doAction, undoAction, context) {
      var idx = stack.push( { undoAction: undoAction, context: context } );
      stack[idx-1].doActionResult = doAction.call(context);
    };
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
      
      //this.set( { "tracks": new TrackCollection } );
      this.tracks = new (Backbone.Collection.extend({
        model: TrackModel,
        
        localStorage: new Backbone.LocalStorage("sc-playlists-"+this.id+"-tracks"),

      }))()
      this.tracks.fetch()
    },

    toNestedJSON: function() {
      var json = this.toJSON();
      json.tracks = this.tracks.toJSON();
      return json;
    },

    saveAll: function() {
        _.each(this.tracks.models, function(track) {
          track.save()
        })

    },

  });
   
  var PlaylistCollection = Backbone.Collection.extend({
    model: PlaylistModel,
    
    localStorage: new Backbone.LocalStorage("sc-playlists"),

    saveAll: function() {
      _.each(this.models, function(playlist) {
        playlist.save()
        playlist.saveAll()
      })
    }
  });

  // Views
  var PlaylistListView = Backbone.View.extend({

    tagName: "div",

    template: Handlebars.compile($('#tpl-playlist-list').html()),

    events: {
      "keypress #add-playlist": "addPlaylist",
      "click .delete-playlist": "delete",
      "click .undo-action": "undo"
    },

    initialize: function () {
      this.model.bind("reset", this.render, this);
      this.model.bind("add", this.render, this);
      this.model.bind("change", this.render, this);
      this.model.bind("remove", this.render, this);
    },

    render: function () {
      $(this.el).html("");
      this.$el.html( this.template( { playlists: this.model.toJSON(), has_history: (history.length() > 0), history_length: history.length() } ) );
      return this;
    },

    addPlaylist: function (event) {
      if (event.keyCode != 13) return;
      var inp = this.$('#add-playlist');
      if (!inp.val()) return;
      history.newAction(function () {
        return this.model.create( { "title": inp.val() } ).id;
      }, function (id) { 
        this.model.get(id).destroy();
      }, this);
      inp.val('');
    },

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
      "click .undo-action": "undo"
    },

    initialize: function () {
        this.model.bind("reset", this.render, this);
        this.model.bind("change", this.render, this);
        this.model.tracks.bind("add", this.render, this);
        this.model.tracks.bind("change", this.render, this);
        this.model.tracks.bind("remove", this.render, this);
    },

    render: function () {
        $(this.el).html("");
        var obj = this.model.toNestedJSON();
        obj.has_history = (history.length() > 0);
        obj.history_length = history.length();
        this.$el.html(this.template(obj));
        return this;
    },

    edit: function (event) {
      event.preventDefault();
      this.$el.addClass("editing");
      this.$('.edit.focus').focus();
    },

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

    playPauseTrack: function (event) {
      event.preventDefault();

      var newTrackId = $(event.currentTarget).attr('data-track-id');
      var track = this.model.tracks.get(newTrackId);
      var trackIndex = this.model.tracks.indexOf(track);

      if (this.currentTrackIndex == trackIndex) {
        this.currentTrack.togglePause();
      } else {
        if (this.currentTrackIndex !== null && this.currentTrack !== null) {
          this.currentTrack.pause();
        }

        this.loopTracks(trackIndex);
      }
    },

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

    currentTrackIndex: null,
    currentTrack: null,

    resetPlayPauseIcons: function () {
      $('.playpause-track i.icon-play').show();
      $('.playpause-track i.icon-pause').hide();
    },

    loopTracks: function (startIndex) {
      this.currentTrackIndex = startIndex;

      this.resetPlayPauseIcons();
      var track = this.model.tracks.at(this.currentTrackIndex);
      var trackId = track.get("id");
      
      var self = this;
      SC.stream("/tracks/"+track.get('trackId'), {
        autoPlay: true,
        onplay: function () {
          self.currentTrack = this;
          $('#playpause-track-'+trackId+' i.icon-play').hide();
          $('#playpause-track-'+trackId+' i.icon-pause').show();
        },
        onpause: function () {
          $('#playpause-track-'+trackId+' i.icon-play').show();
          $('#playpause-track-'+trackId+' i.icon-pause').hide();
        },
        onfinish: function () {
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

    addTrack: function (e) {
      if (e.keyCode != 13) return;
      var inp = this.$('#add-track');
      if (!inp.val()) return;
      var self = this;
      var scTrack = SC.get("/resolve", {url: inp.val()}, function (obj, err) {
        if (err === null && typeof(obj.kind) !== 'undefined' && obj.kind == "track") {
          history.newAction(function () {
            return this.model.tracks.create( { title: obj.title, 
                                               trackId: obj.id, 
                                               userId: obj.user_id, 
                                               username: obj.user.username }).id;
          }, function (id) { 
            this.model.tracks.get(id).destroy();
          }, self);
        } else {
          alert("The provided url is not a valid soundcloud track.");
        }
      });

      inp.val('');
    },

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
        this.playlistList = new PlaylistCollection;
      },
   
      playlists: function () {
        this.playlistListView = new PlaylistListView({model:this.playlistList});
        this.playlistList.fetch();
        $('#content').html(this.playlistListView.render().el);        
      },
   
      showPlaylist: function (id) {
        this.playlistList.fetch();
        this.playlist = this.playlistList.get(id);
        this.playlistView = new PlaylistView( { model: this.playlist } );
        $('#content').html(this.playlistView.render().el);
      }
  });
   
  var app = new AppRouter();
  Backbone.history.start();

});
