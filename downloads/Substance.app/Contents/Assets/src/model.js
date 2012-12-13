// Document.Store (web debug)
// -----------------

var DocumentStore = function() {

};

DocumentStore.prototype.get = function(id, cb) {
  // HACK: under webkitgtk XMLHttpRequests do not work for local resources :(
  //       workaround is to add a native extension that loads local data
  //       usage: substance.resources.getJSON(url)  - returns JS object
  //          or  substance.resources.get(url)      - returns content as String
  if (typeof substance !== "undefined" &&
    typeof substance.resources !== "undefined") {
     doc = substance.resources.getJSON('data/'+ (id+'.json'));
     cb(null, doc);
  } else {
    $.getJSON('data/'+ (id+'.json'), function(doc) {
      cb(null, doc);
    });
  }
};


DocumentStore.prototype.create = function(cb) {
  cb(null, {id: Math.uuid()});
};


DocumentStore.prototype.update = function(id, operations, cb) {
  // Implement
};


DocumentStore.prototype.delete = function(id, cb) {
  // Implement
};


// RedisDocumentStore (native)
// -----------------

var RedisDocumentStore = function() {
  this.store = new redis.RedisDocStore();
};


RedisDocumentStore.prototype.create = function(cb) {
  this.store.create(Math.uuid(), cb);
};


RedisDocumentStore.prototype.get = function(id, cb) {
  this.store.get(id, cb);
};

RedisDocumentStore.prototype.update = function(id, commits, cb) {
  // Implement
  this.store.update(id, commits, cb);
};

RedisDocumentStore.prototype.setSnapshot = function(id, content, scope, cb) {
  this.store.setSnapshot(id, content, scope, cb);
};

RedisDocumentStore.prototype.list = function(cb) {
  this.store.list(cb);
};

RedisDocumentStore.prototype.delete = function(id, cb) {
  // Implement
  this.store.delete(id, cb);
};




var store = new RedisDocumentStore();

// var store = new DocumentStore();

// Update doc (docstore.update)
// -----------------

function updateDoc(document, commit, cb) {
  store.update(document.id, [commit], function(err) {
    store.setSnapshot(document.id, document.content, 'master', function(err) {
      console.log('updated', document.id, [commit]);
    });
  });
}

// Comments
// -----------------
// Called by Substance.Text

var Comments = function(session) {
  this.session = session;
  this.scopes = [];
};


_.extend(Comments.prototype, _.Events, {
  compute: function(scope) {

    var node = this.session.node();
    this.scopes = [];

    if (node) {
      var content = this.session.document.content.nodes[node].content;
      var annotations = this.session.document.annotations(node);
    }

    this.commentsForNode(this.session.document, node, content, annotations, scope);
  },

  // Based on a new set of annotations (during editing)
  updateAnnotations: function(content, annotations) {
    var node = this.session.node();

    // Only consider markers as comment scopes
    var annotations = _.filter(annotations, function(a) {
      return _.include(["idea", "blur", "doubt"], a.type);
    });

    this.commentsForNode(this.session.document, node, content, annotations);
  },

  commentsForNode: function(document, node, content, annotations, scope) {
    this.scopes = [];

    // Extract annotation text from the model
    function annotationText(a) {
      if (!a.pos) return "No pos";
      return content.substr(a.pos[0], a.pos[1]);
    }

    if (node) {
      this.scopes.push({
        name: "Node",
        type: "node",
        id: "node_comments",
        comments: document.comments(node)
      });

      _.each(annotations, function(a) {
        this.scopes.push({
          name: annotationText(a),
          type: a.type,
          annotation: a.id,
          id: a.id,
          comments: document.commentsForAnnotation(a.id)
        });
      }, this);
    } else {
      this.scopes.push({
        id: "document_comments",
        name: "Document",
        type: "document",
        comments: document.documentComments()
      });
    }

    this.session.trigger('comments:updated', scope);
  }
});


// Substance.Session
// -----------------
// 
// The Composer works with a session object, which maintains 
// all the state of a document session
// TODO: No multiuser support yet, use app.user

Substance.Session = function(options) {
  this.document = options.document;

  this.users = {
    "michael": {
      "color": "#2F2B26",
      "selection": []
    }
  };

  this.selections = {};

  // Comments view
  this.comments = new Comments(this);

  // That's the current editor
  this.user = "michael";
};

_.extend(Substance.Session.prototype, _.Events, {
  select: function(nodes, options) {
    if (!options) options = {};
    var user = options.user || this.user; // Use current user by default

    // Do nothing if selection hasn't changed
    if (!this.hasChanged(user, nodes, !!options.edit)) return;

    this.edit = !!options.edit;

    if (this.users[this.user].selection) {
      _.each(this.users[user].selection, function(node) {
        delete this.selections[node];
      }, this);
    }

    this.users[user].selection = nodes;
    _.each(nodes, function(node) {
      this.selections[node] = user;
    }, this);
    
    // New selection leads to new comment context
    this.comments.compute();

    this.trigger('node:selected');
  },

  // Checks if selection has actually changed for a user
  hasChanged: function(user, nodes, edit) {
    return !_.isEqual(nodes, this.selection(user)) || edit !== this.edit;
  },

  // Retrieve current node selection
  selection: function(user) {
    if (!user) user = this.user;
    return this.users[user].selection;
  },

  // Returns the node id of current active node
  // Only works if there's just one node selected
  node: function() {
    var lvl = this.level(),
        sel = this.selection();

    if (lvl >= 2 && sel.length === 1) {
      return sel[0];
    }
  },

  // Returns current navigation level (1..3)
  level: function() {
    var selection = this.users[this.user].selection;

    // Edit mode
    if (this.edit) return 3;

    // Selection mode (one or more nodes)
    if (selection.length >= 1) return 2;

    // no selection -> document level
    return 1;
  }
});


// Fetch a document
// -----------------

function loadDocument(id, cb) {
  store.get(id, function(err, doc) {
    var session = new Substance.Session({
      document: new Substance.Document(doc)
    });
    cb(err, session);
  });
}

// List all documents
// -----------------

function listDocuments(cb) {
  store.list(function(err, documents) {
    var res = _.map(documents, function(doc) {
      return {
        title: doc.properties.title,
        author: "le_author",
        file: doc.id,
        id: doc.id
      };
    });
    cb(null, res);
  });
}

// Create a new document
// -----------------

function createDocument(cb) {
  store.create(function(err, doc) {

    var session = new Substance.Session({
      document: new Substance.Document(doc)
    });

    cb(err, session);
  });
}

// Authenticate with your Substance user
// -----------------

function authenticate(options, cb) {
  // talk.send(["session:authenticate", options], function(err) {
  //   cb(err);
  // });
  cb(null);
}